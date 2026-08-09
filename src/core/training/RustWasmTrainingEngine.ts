import type {
    ActiveTrainingBackend,
    Genome,
    LocomotionCurriculumStage,
    LocomotionMetrics,
    MuscleGene,
    PackedTrainingReplay,
    Topology,
    TrainingEngineConfig,
    TrainingEngineState,
    TrainingSnapshot,
    TrainingStageTimings,
} from "@/core/types"
import type { EvaluatedGeneration, TrainingBackendEngine } from "./engineBackend"
import { captureReplayFrames } from "./replayCapture"
import { BehaviorArchive, compileFunctionalAnatomy, emptyLocomotionMetrics } from "./locomotion"

interface TrainingWasmExports {
    memory: WebAssembly.Memory
    training_alloc_f32(length: number): number
    training_dealloc_f32(pointer: number, length: number): void
    training_init(pointer: number, length: number): number
    training_run_steps(maximum: number): number
    training_finish_generation(): void
    training_generation(): number
    training_progress(): number
    training_update_config(
        mutationRate: number,
        mutationStrength: number,
        elitism: number,
        parentPercent: number,
        targetDistance: number,
    ): void
    training_genomes_ptr(): number
    training_genomes_len(): number
    training_x_ptr(): number
    training_x_len(): number
    training_y_ptr(): number
    training_y_len(): number
    training_center_x_ptr(): number
    training_center_x_len(): number
    training_center_y_ptr(): number
    training_center_y_len(): number
    training_last_best_ptr(): number
    training_last_best_len(): number
    training_last_target_ptr(): number
    training_last_target_len(): number
    training_best_ever_ptr(): number
    training_best_ever_len(): number
    training_summary_ptr(): number
    training_summary_len(): number
    training_last_best_metrics_ptr(): number
    training_last_best_metrics_len(): number
    training_last_target_metrics_ptr(): number
    training_last_target_metrics_len(): number
    training_archive_cells_ptr(): number
    training_archive_cells_len(): number
    training_archive_metrics_ptr(): number
    training_archive_metrics_len(): number
    training_archive_genomes_ptr(): number
    training_archive_genomes_len(): number
}

/** Produces deterministic initial values without allocating genome objects in the worker. */
class SeededRandom {
    private state: number

    constructor(seed: number) {
        this.state = seed >>> 0 || 0x6d2b79f5
    }

    next(): number {
        let value = this.state
        value ^= value << 13
        value ^= value >>> 17
        value ^= value << 5
        this.state = value >>> 0
        return this.state / 0x100000000
    }
}

/** Rust/WASM training backend using a raw flat-buffer ABI and persistent linear memory. */
export class RustWasmTrainingEngine implements TrainingBackendEngine {
    private readonly exports: TrainingWasmExports
    private readonly topology: Topology
    private config: TrainingEngineConfig
    private readonly backend: ActiveTrainingBackend
    private readonly muscleIds: string[]
    private readonly populationSize: number
    private readonly particleCount: number
    private readonly timings: TrainingStageTimings
    private readonly generationDurations: number[] = []
    private generationStartedAt = performance.now()
    private lastSimulationMs = 0
    private bestFitness = Number.NEGATIVE_INFINITY
    private bestMetrics: LocomotionMetrics = emptyLocomotionMetrics()
    private curriculumStage: LocomotionCurriculumStage = "discovery"
    private archive: BehaviorArchive

    static async create(
        topology: Topology,
        config: TrainingEngineConfig,
        initialPopulation?: Genome[],
        initialGeneration = 1,
        backend: ActiveTrainingBackend = "wasm-scalar",
        initialArchive?: TrainingEngineState["archive"],
        initialBestMetrics?: LocomotionMetrics,
    ): Promise<RustWasmTrainingEngine> {
        const asset = backend === "wasm-simd" ? "/training-engine-simd.wasm" : "/training-engine-scalar.wasm"
        const response = await fetch(new URL(asset, self.location.origin))
        if (!response.ok) throw new Error(`Unable to load ${asset}`)
        const result = await WebAssembly.instantiateStreaming(response, {})
        return new RustWasmTrainingEngine(
            result.instance.exports as unknown as TrainingWasmExports,
            topology,
            config,
            initialPopulation,
            initialGeneration,
            backend,
            initialArchive,
            initialBestMetrics,
        )
    }

    private constructor(
        exports: TrainingWasmExports,
        topology: Topology,
        config: TrainingEngineConfig,
        initialPopulation: Genome[] | undefined,
        initialGeneration: number,
        backend: ActiveTrainingBackend,
        initialArchive?: TrainingEngineState["archive"],
        initialBestMetrics?: LocomotionMetrics,
    ) {
        const startedAt = performance.now()
        this.exports = exports
        this.topology = topology
        this.config = config
        this.backend = backend
        this.archive = new BehaviorArchive(initialArchive)
        this.bestMetrics = initialBestMetrics ?? emptyLocomotionMetrics()
        this.muscleIds = topology.muscles.map((muscle) => muscle.id)
        this.populationSize = config.populationSize
        this.particleCount = topology.particles.length
        const input = this.createInput(initialPopulation, initialGeneration)
        const pointer = exports.training_alloc_f32(input.length)
        new Float32Array(exports.memory.buffer, pointer, input.length).set(input)
        const initialized = exports.training_init(pointer, input.length)
        exports.training_dealloc_f32(pointer, input.length)
        if (!initialized) throw new Error("Rust training engine rejected its initialization buffer")
        this.timings = {
            initializeMs: performance.now() - startedAt,
            simulationMs: 0,
            fitnessMs: 0,
            evolutionMs: 0,
            resetMs: 0,
            transferMs: 0,
            totalGenerationMs: 0,
        }
    }

    updateConfig(config: TrainingEngineConfig): void {
        this.config = config
        this.exports.training_update_config(
            config.mutationRate,
            config.mutationStrength,
            config.elitismCount,
            config.parentsTopPercent,
            config.targetDistance,
        )
    }

    getGeneration(): number {
        return this.exports.training_generation()
    }

    getProgress(): number {
        return this.exports.training_progress()
    }

    runChunk(maxSteps: number, budgetMs: number): boolean {
        const startedAt = performance.now()
        let completed = false
        do {
            completed = this.exports.training_run_steps(maxSteps) !== 0
        } while (this.config.backgroundMode && !completed && performance.now() - startedAt < budgetMs)
        const elapsed = performance.now() - startedAt
        this.lastSimulationMs += elapsed
        this.timings.simulationMs = this.lastSimulationMs
        return completed
    }

    finishGeneration(): EvaluatedGeneration {
        const startedAt = performance.now()
        this.exports.training_finish_generation()
        const summary = this.readSlice(this.exports.training_summary_ptr(), this.exports.training_summary_len())
        const generation = summary[0]
        this.bestMetrics = this.materializeMetrics(this.readSlice(this.exports.training_last_best_metrics_ptr(), this.exports.training_last_best_metrics_len()))
        const targetMetrics = summary[4] >= 0
            ? this.materializeMetrics(this.readSlice(this.exports.training_last_target_metrics_ptr(), this.exports.training_last_target_metrics_len()))
            : null
        this.archive = new BehaviorArchive(this.readArchive(generation))
        this.curriculumStage = summary[8] === 2 ? "refinement" : summary[8] === 1 ? "coordination" : "discovery"
        const transitionMs = performance.now() - startedAt
        this.timings.fitnessMs = transitionMs
        this.timings.evolutionMs = 0
        this.timings.resetMs = 0
        this.timings.totalGenerationMs = performance.now() - this.generationStartedAt
        this.generationDurations.push(this.timings.totalGenerationMs)
        if (this.generationDurations.length > 30) this.generationDurations.shift()
        this.generationStartedAt = performance.now()
        this.lastSimulationMs = 0
        this.bestFitness = Math.max(this.bestFitness, summary[1])
        return {
            generation,
            bestFitness: summary[1],
            averageFitness: summary[2],
            bestIndex: summary[3],
            targetIndex: summary[4],
            bestGenome: this.materializeGenome(
                this.readSlice(this.exports.training_last_best_ptr(), this.exports.training_last_best_len()),
                `genome-${generation}-best`,
                generation,
            ),
            targetGenome: summary[4] >= 0
                ? this.materializeGenome(
                    this.readSlice(this.exports.training_last_target_ptr(), this.exports.training_last_target_len()),
                    `genome-${generation}-target`,
                    generation,
                )
                : null,
            bestMetrics: this.bestMetrics,
            targetMetrics,
            archiveCoverage: this.archive.coverage(),
            curriculumStage: this.curriculumStage,
        }
    }

    getSnapshot(phase: TrainingSnapshot["phase"], includeRender: boolean): TrainingSnapshot {
        const averageDuration = this.generationDurations.length
            ? this.generationDurations.reduce((sum, duration) => sum + duration, 0) / this.generationDurations.length
            : 0
        return {
            phase,
            generation: this.getGeneration(),
            progress: Math.round(this.getProgress()),
            bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : 0,
            averageFitness: 0,
            bestMetrics: this.bestMetrics,
            archiveCoverage: this.archive.coverage(),
            curriculumStage: this.curriculumStage,
            diagnostics: {
                backend: this.backend,
                workerCount: 1,
                generationsPerSecond: averageDuration ? 1000 / averageDuration : 0,
                stageTimings: { ...this.timings },
                droppedSnapshots: 0,
                memoryBytes: this.exports.memory.buffer.byteLength,
            },
            render: includeRender ? this.createRenderSnapshot(5) : undefined,
        }
    }

    getBestGenome(): Genome | null {
        const values = this.readSlice(this.exports.training_best_ever_ptr(), this.exports.training_best_ever_len())
        return values.length ? this.materializeGenome(values, `genome-best-${this.getGeneration()}`, this.getGeneration()) : null
    }

    exportState(): TrainingEngineState {
        const values = this.readSlice(this.exports.training_genomes_ptr(), this.exports.training_genomes_len())
        const stride = this.muscleIds.length * 6
        const generation = this.getGeneration()
        const population = Array.from({ length: this.populationSize }, (_, creature) =>
            this.materializeGenome(
                values.subarray(creature * stride, (creature + 1) * stride),
                `genome-${generation}-${creature}`,
                generation,
            ),
        )
        return {
            population,
            bestGenome: this.getBestGenome(),
            bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : 0,
            generation,
            archive: this.archive.export(),
            bestMetrics: this.bestMetrics,
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

    private createInput(initialPopulation: Genome[] | undefined, initialGeneration: number): Float32Array {
        const particleIds = new Map(this.topology.particles.map((particle, index) => [particle.id, index]))
        const constraintCount = this.topology.constraints.length + this.topology.muscles.length
        const anatomy = compileFunctionalAnatomy(this.topology)
        const genomeStride = this.muscleIds.length * 6
        const genomeLength = this.populationSize * genomeStride
        const archive = this.archive.export().elites
        const archiveStride = 1 + 16 + genomeStride
        const values = new Float32Array(
            17 + this.particleCount * 10 + constraintCount * 5 + anatomy.contactGroups.length + genomeLength + archive.length * archiveStride,
        )
        values.set([
            this.populationSize,
            this.particleCount,
            constraintCount,
            this.muscleIds.length,
            Math.max(1, Math.round(this.config.generationDuration * 60)),
            initialGeneration,
            this.config.seed & 0x00ffffff,
            this.config.mutationRate,
            this.config.mutationStrength,
            this.config.elitismCount,
            this.config.parentsTopPercent,
            this.config.targetDistance,
            600,
            570,
            anatomy.contactGroups.length,
            30,
            archive.length,
        ])
        let cursor = 17
        for (let particleIndex = 0; particleIndex < this.topology.particles.length; particleIndex++) {
            const particle = this.topology.particles[particleIndex]
            values.set([
                particle.initialPos.x,
                particle.initialPos.y,
                particle.mass,
                particle.radius,
                particle.isLocked ? 1 : 0,
                particle.isHead || particle.id === "head" ? 1 : 0,
                anatomy.coreIndices.includes(particleIndex) ? 1 : 0,
                anatomy.protectedMask[particleIndex],
                anatomy.particleGroup[particleIndex],
                anatomy.branchGroup[particleIndex],
            ], cursor)
            cursor += 10
        }
        for (const constraint of this.topology.constraints) {
            values.set([
                particleIds.get(constraint.p1Id) ?? 0,
                particleIds.get(constraint.p2Id) ?? 0,
                constraint.restLength,
                constraint.stiffness,
                -1,
            ], cursor)
            cursor += 5
        }
        this.topology.muscles.forEach((muscle, muscleIndex) => {
            values.set([
                particleIds.get(muscle.p1Id) ?? 0,
                particleIds.get(muscle.p2Id) ?? 0,
                muscle.baseLength,
                0.9,
                muscleIndex,
            ], cursor)
            cursor += 5
        })
        for (const group of anatomy.contactGroups) values[cursor++] = group.pairedGroup
        const random = new SeededRandom(this.config.seed)
        for (let creature = 0; creature < this.populationSize; creature++) {
            for (let muscle = 0; muscle < this.muscleIds.length; muscle++) {
                const gene = initialPopulation?.[creature]?.genes.find((candidate) => candidate.muscleId === this.muscleIds[muscle])
                values[cursor++] = gene?.amplitude ?? random.next() * 0.5 + 0.1
                values[cursor++] = gene?.frequency ?? random.next() * 2 + 0.1
                values[cursor++] = gene?.phase ?? random.next() * Math.PI * 2
                values[cursor++] = gene?.couplingStrength ?? (initialPopulation ? 0 : random.next() * 0.25)
                values[cursor++] = gene?.contactReflexGain ?? (initialPopulation ? 0 : (random.next() - 0.5) * 0.3)
                values[cursor++] = gene?.postureReflexGain ?? (initialPopulation ? 0 : (random.next() - 0.5) * 0.3)
            }
        }
        for (const elite of archive) {
            values[cursor++] = elite.cell
            const metrics = this.packMetrics(elite.metrics)
            values.set(metrics, cursor); cursor += metrics.length
            for (const muscleId of this.muscleIds) {
                const gene = elite.genome.genes.find((candidate) => candidate.muscleId === muscleId)
                values.set([gene?.amplitude ?? 0.2, gene?.frequency ?? 1, gene?.phase ?? 0, gene?.couplingStrength ?? 0, gene?.contactReflexGain ?? 0, gene?.postureReflexGain ?? 0], cursor)
                cursor += 6
            }
        }
        return values
    }

    private readSlice(pointer: number, length: number): Float32Array {
        if (!pointer || !length) return new Float32Array()
        return new Float32Array(this.exports.memory.buffer, pointer, length).slice()
    }

    private materializeGenome(values: Float32Array, id: string, generation: number): Genome {
        const genes: MuscleGene[] = this.muscleIds.map((muscleId, muscle) => ({
            muscleId,
            amplitude: values[muscle * 6],
            frequency: values[muscle * 6 + 1],
            phase: values[muscle * 6 + 2],
            couplingStrength: values[muscle * 6 + 3],
            contactReflexGain: values[muscle * 6 + 4],
            postureReflexGain: values[muscle * 6 + 5],
        }))
        return { id, genes, generation, createdAt: Date.now() }
    }

    private materializeMetrics(values: Float32Array): LocomotionMetrics {
        if (values.length < 16) return emptyLocomotionMetrics()
        return {
            progress: values[0], sustainedProgress: values[1], locomotionQuality: values[2],
            contactUtilization: values[3], periodicity: values[4], coordination: values[5],
            traction: values[6], carriage: values[7], smoothness: values[8], energyEfficiency: values[9],
            transportCost: values[10], airborneRatio: values[11], survivalRatio: values[12],
            descriptor: [values[13], values[14], values[15]],
        }
    }

    private packMetrics(metrics: LocomotionMetrics): Float32Array {
        return Float32Array.from([
            metrics.progress, metrics.sustainedProgress, metrics.locomotionQuality, metrics.contactUtilization,
            metrics.periodicity, metrics.coordination, metrics.traction, metrics.carriage, metrics.smoothness,
            metrics.energyEfficiency, metrics.transportCost, metrics.airborneRatio, metrics.survivalRatio,
            ...metrics.descriptor,
        ])
    }

    private readArchive(generation: number): TrainingEngineState["archive"] {
        const cells = this.readSlice(this.exports.training_archive_cells_ptr(), this.exports.training_archive_cells_len())
        const metrics = this.readSlice(this.exports.training_archive_metrics_ptr(), this.exports.training_archive_metrics_len())
        const genomes = this.readSlice(this.exports.training_archive_genomes_ptr(), this.exports.training_archive_genomes_len())
        const stride = this.muscleIds.length * 6
        return {
            dimensions: [12, 10, 8],
            elites: Array.from({ length: cells.length }, (_, index) => ({
                cell: cells[index],
                descriptor: [metrics[index * 16 + 13], metrics[index * 16 + 14], metrics[index * 16 + 15]],
                metrics: this.materializeMetrics(metrics.subarray(index * 16, index * 16 + 16)),
                genome: this.materializeGenome(genomes.subarray(index * stride, (index + 1) * stride), `archive-${cells[index]}`, generation),
            })),
        }
    }

    private createRenderSnapshot(maximum: number): TrainingSnapshot["render"] {
        const x = this.readSlice(this.exports.training_x_ptr(), this.exports.training_x_len())
        const y = this.readSlice(this.exports.training_y_ptr(), this.exports.training_y_len())
        const centerX = this.readSlice(this.exports.training_center_x_ptr(), this.exports.training_center_x_len())
        const centerY = this.readSlice(this.exports.training_center_y_ptr(), this.exports.training_center_y_len())
        const ranked = Array.from({ length: this.populationSize }, (_, index) => index)
        ranked.sort((left, right) => centerX[right] - centerX[left])
        const creatureCount = Math.min(maximum, this.populationSize)
        const positions = new Float32Array(creatureCount * this.particleCount * 2)
        const centers = new Float32Array(creatureCount * 2)
        for (let output = 0; output < creatureCount; output++) {
            const creature = ranked[output]
            centers[output * 2] = centerX[creature]
            centers[output * 2 + 1] = centerY[creature]
            for (let particle = 0; particle < this.particleCount; particle++) {
                const source = creature * this.particleCount + particle
                const target = (output * this.particleCount + particle) * 2
                positions[target] = x[source]
                positions[target + 1] = y[source]
            }
        }
        return { creatureCount, particleCount: this.particleCount, positions, centers }
    }
}
