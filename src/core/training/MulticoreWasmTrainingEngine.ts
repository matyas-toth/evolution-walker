import type {
    ActiveTrainingBackend,
    Genome,
    PackedTrainingReplay,
    PackedRenderSnapshot,
    Topology,
    TrainingEngineConfig,
    TrainingEngineState,
    TrainingSnapshot,
    TrainingStageTimings,
    EvolutionPolicyState,
} from "@/core/types"
import type { EvaluatedGeneration, TrainingBackendEngine } from "./engineBackend"
import { RustWasmTrainingEngine, type WasmEvaluationBatch } from "./RustWasmTrainingEngine"
import { captureReplayFrames } from "./replayCapture"
import { CANDIDATE_METRIC_STRIDE, EvolutionPolicyV3 } from "./EvolutionPolicyV3"

interface ShardResponse {
    id: number
    ok?: boolean
    error?: string
    completed?: boolean
    progress?: number
    evaluated?: EvaluatedGeneration
    snapshot?: TrainingSnapshot
    state?: TrainingEngineState
    batch?: WasmEvaluationBatch
}

class ShardClient {
    private readonly worker: Worker
    private readonly pending = new Map<number, { resolve(value: ShardResponse): void; reject(error: Error): void }>()
    private requestId = 0

    constructor() {
        this.worker = new Worker(new URL("./training.shard.worker.ts", import.meta.url), { type: "module", name: "evolution-training-shard" })
        this.worker.onmessage = (message: MessageEvent<ShardResponse>) => {
            const response = message.data
            const request = this.pending.get(response.id)
            if (!request) return
            this.pending.delete(response.id)
            if (response.error) request.reject(new Error(response.error))
            else request.resolve(response)
        }
        this.worker.onerror = (event) => {
            const error = new Error(event.message || "Training shard failed")
            for (const request of this.pending.values()) request.reject(error)
            this.pending.clear()
        }
    }

    request(command: Record<string, unknown>): Promise<ShardResponse> {
        const id = ++this.requestId
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject })
            this.worker.postMessage({ ...command, id })
        })
    }
}

interface ShardDescriptor {
    client: ShardClient
    populationSize: number
}

/** Island-model WASM pool that evaluates persistent shards concurrently. */
export class MulticoreWasmTrainingEngine implements TrainingBackendEngine {
    private readonly shards: ShardDescriptor[]
    private readonly topology: Topology
    private config: TrainingEngineConfig
    private readonly backend: ActiveTrainingBackend
    private generation: number
    private progress = 0
    private bestFitness = Number.NEGATIVE_INFINITY
    private bestGenome: Genome | null = null
    private pendingEvaluation: EvaluatedGeneration | null = null
    private lastRender: PackedRenderSnapshot | undefined
    private readonly timings: TrainingStageTimings
    private readonly generationDurations: number[] = []
    private generationStartedAt = performance.now()
    private memoryBytes = 0
    private readonly policy: EvolutionPolicyV3

    static async create(topology: Topology, config: TrainingEngineConfig, population: Genome[] | undefined, generation: number, backend: ActiveTrainingBackend, policyState?: EvolutionPolicyState): Promise<MulticoreWasmTrainingEngine> {
        const startedAt = performance.now()
        const hardwareWorkers = Math.max(1, (navigator.hardwareConcurrency || 2) - 1)
        const requested = config.workerCount === "auto" ? hardwareWorkers : Math.max(1, Math.floor(config.workerCount))
        const workerCount = Math.max(1, Math.min(requested, Math.ceil(config.populationSize / 64), 12))
        const descriptors: ShardDescriptor[] = []
        let populationCursor = 0
        for (let shard = 0; shard < workerCount; shard++) {
            const remainingWorkers = workerCount - shard
            const size = Math.ceil((config.populationSize - populationCursor) / remainingWorkers)
            const client = new ShardClient()
            const shardConfig: TrainingEngineConfig = { ...config, populationSize: size, workerCount: 1, seed: (config.seed + shard * 0x9e3779b9) >>> 0 }
            await client.request({ type: "init", topology, config: shardConfig, population: population?.slice(populationCursor, populationCursor + size), generation, backend, externalEvolution: true })
            descriptors.push({ client, populationSize: size })
            populationCursor += size
        }
        const engine = new MulticoreWasmTrainingEngine(descriptors, topology, config, generation, backend, policyState)
        engine.timings.initializeMs = performance.now() - startedAt
        return engine
    }

    private constructor(shards: ShardDescriptor[], topology: Topology, config: TrainingEngineConfig, generation: number, backend: ActiveTrainingBackend, policyState?: EvolutionPolicyState) {
        this.shards = shards
        this.topology = topology
        this.config = config
        this.generation = generation
        this.backend = backend
        this.policy = new EvolutionPolicyV3(topology, config, policyState)
        this.bestGenome = this.policy.getChampionGenome(generation)
        this.bestFitness = this.policy.getChampionFitness()
        this.timings = { initializeMs: 0, simulationMs: 0, fitnessMs: 0, evolutionMs: 0, resetMs: 0, transferMs: 0, totalGenerationMs: 0 }
    }

    updateConfig(config: TrainingEngineConfig): void {
        this.config = config
        this.policy.updateConfig(config)
        for (const shard of this.shards) {
            const shardConfig = { ...config, populationSize: shard.populationSize, workerCount: 1 }
            void shard.client.request({ type: "update", config: shardConfig })
        }
    }

    getGeneration(): number { return this.generation }
    getProgress(): number { return this.progress }

    async runChunk(maxSteps: number, budgetMs: number): Promise<boolean> {
        if (this.progress === 0) this.timings.simulationMs = 0
        const startedAt = performance.now()
        const responses = await Promise.all(this.shards.map((shard) => shard.client.request({
            type: "run",
            maxSteps,
            budgetMs,
            includeRender: !this.config.backgroundMode,
        })))
        this.timings.simulationMs += performance.now() - startedAt
        this.progress = responses.reduce((sum, response) => sum + (response.progress ?? 0), 0) / responses.length
        if (!this.config.backgroundMode) {
            this.lastRender = this.combineRenderSnapshots(responses)
            this.memoryBytes = responses.reduce((sum, response) => sum + (response.snapshot?.diagnostics.memoryBytes ?? 0), 0)
        }
        if (!responses.every((response) => response.completed)) return false

        const transitionStarted = performance.now()
        const finished = await Promise.all(this.shards.map((shard) => shard.client.request({ type: "finish" })))
        this.timings.fitnessMs = performance.now() - transitionStarted
        this.memoryBytes = finished.reduce((sum, response) => sum + (response.snapshot?.diagnostics.memoryBytes ?? 0), 0)
        await this.evolveGlobally(finished)
        this.lastRender = this.combineRenderSnapshots(finished)
        this.timings.totalGenerationMs = performance.now() - this.generationStartedAt
        this.generationDurations.push(this.timings.totalGenerationMs)
        if (this.generationDurations.length > 30) this.generationDurations.shift()
        this.generationStartedAt = performance.now()
        this.progress = 100
        return true
    }

    finishGeneration(): EvaluatedGeneration {
        if (!this.pendingEvaluation) throw new Error("WASM shards have not completed a generation")
        const evaluation = this.pendingEvaluation
        this.pendingEvaluation = null
        this.generation++
        this.progress = 0
        return evaluation
    }

    getSnapshot(phase: TrainingSnapshot["phase"], includeRender: boolean): TrainingSnapshot {
        const policyDiagnostics = this.policy.getDiagnostics()
        const average = this.generationDurations.length ? this.generationDurations.reduce((sum, value) => sum + value, 0) / this.generationDurations.length : 0
        return {
            phase, generation: this.generation, progress: Math.round(this.progress),
            bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : 0,
            averageFitness: this.pendingEvaluation?.averageFitness ?? 0,
            diagnostics: {
                backend: this.backend, workerCount: this.shards.length,
                generationsPerSecond: average ? 1000 / average : 0,
                stageTimings: { ...this.timings }, droppedSnapshots: 0, memoryBytes: this.memoryBytes,
                policyVersion: 3,
                bestDistance: this.pendingEvaluation?.bestDistance ?? policyDiagnostics.bestDistance,
                medianDistance: this.pendingEvaluation?.medianDistance,
                p90Distance: this.pendingEvaluation?.p90Distance,
                bestGaitQuality: this.pendingEvaluation?.bestGaitQuality,
                archiveCoverage: this.pendingEvaluation?.archiveCoverage ?? policyDiagnostics.archiveCoverage,
                genomeDiversity: this.pendingEvaluation?.genomeDiversity,
                stagnationGenerations: this.pendingEvaluation?.stagnationGenerations ?? policyDiagnostics.stagnationGenerations,
            },
            render: includeRender ? this.lastRender : undefined,
        }
    }

    getBestGenome(): Genome | null { return this.bestGenome }

    async exportState(): Promise<TrainingEngineState> {
        const responses = await Promise.all(this.shards.map((shard) => shard.client.request({ type: "export" })))
        return {
            population: responses.flatMap((response) => response.state?.population ?? []),
            bestGenome: this.bestGenome,
            bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : 0,
            generation: this.generation,
            policyState: this.policy.exportState(),
        }
    }

    async createReplay(genome: Genome): Promise<PackedTrainingReplay> {
        const replayConfig: TrainingEngineConfig = {
            ...this.config,
            backend: this.backend,
            populationSize: 1,
            workerCount: 1,
            backgroundMode: false,
        }
        const replayEngine = await RustWasmTrainingEngine.create(
            this.topology,
            replayConfig,
            [genome],
            genome.generation,
            this.backend,
        )
        return captureReplayFrames(replayEngine, this.topology, replayConfig, genome, this.backend)
    }

    private async evolveGlobally(responses: ShardResponse[]): Promise<void> {
        const batches = responses.map((response) => response.batch).filter((batch): batch is WasmEvaluationBatch => Boolean(batch))
        if (batches.length !== this.shards.length) throw new Error("WASM shards returned incomplete evaluation metrics")
        const population = batches.flatMap((batch) => batch.population)
        const values = new Float32Array(this.config.populationSize * CANDIDATE_METRIC_STRIDE)
        let metricCursor = 0
        for (const batch of batches) {
            values.set(batch.metrics.values, metricCursor)
            metricCursor += batch.metrics.values.length
        }
        const evolutionStartedAt = performance.now()
        const result = this.policy.evaluateAndEvolve(population, { populationSize: population.length, values }, this.generation)
        let cursor = 0
        await Promise.all(this.shards.map((shard) => {
            const next = result.genomes.slice(cursor, cursor + shard.populationSize)
            cursor += shard.populationSize
            return shard.client.request({ type: "install", population: next })
        }))
        this.timings.evolutionMs = performance.now() - evolutionStartedAt
        this.bestFitness = Math.max(this.bestFitness, result.bestFitness)
        this.bestGenome = result.championGenome
        this.pendingEvaluation = {
            generation: this.generation,
            bestFitness: result.bestFitness,
            averageFitness: result.averageFitness,
            bestIndex: result.bestIndex,
            targetIndex: result.targetIndex,
            bestGenome: population[result.bestIndex],
            targetGenome: result.targetIndex >= 0 ? population[result.targetIndex] : null,
            bestDistance: result.bestDistance,
            medianDistance: result.medianDistance,
            p90Distance: result.p90Distance,
            bestGaitQuality: result.bestGaitQuality,
            archiveCoverage: result.archiveCoverage,
            genomeDiversity: result.genomeDiversity,
            stagnationGenerations: result.stagnationGenerations,
            bestProgress: result.bestDistance / Math.max(1, this.config.targetDistance - 100),
            bestSurvival: result.scores[result.bestIndex].survival,
            bestSupportTransitions: result.scores[result.bestIndex].alternatingTransitions,
        }
    }

    private combineRenderSnapshots(responses: ShardResponse[]): PackedRenderSnapshot | undefined {
        const renders = responses.map((response) => response.snapshot?.render).filter((render): render is PackedRenderSnapshot => Boolean(render))
        if (!renders.length) return undefined
        const particleCount = this.topology.particles.length
        const creatureCount = Math.min(5, renders.length)
        const positions = new Float32Array(creatureCount * particleCount * 2)
        const centers = new Float32Array(creatureCount * 2)
        for (let creature = 0; creature < creatureCount; creature++) {
            positions.set(renders[creature].positions.subarray(0, particleCount * 2), creature * particleCount * 2)
            centers.set(renders[creature].centers.subarray(0, 2), creature * 2)
        }
        return { creatureCount, particleCount, positions, centers }
    }
}
