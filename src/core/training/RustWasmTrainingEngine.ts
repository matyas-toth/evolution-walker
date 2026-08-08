import type {
    ActiveTrainingBackend,
    Genome,
    MuscleGene,
    Topology,
    TrainingEngineConfig,
    TrainingEngineState,
    TrainingSnapshot,
    TrainingStageTimings,
} from "@/core/types"
import type { EvaluatedGeneration, TrainingBackendEngine } from "./engineBackend"

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

    static async create(
        topology: Topology,
        config: TrainingEngineConfig,
        initialPopulation?: Genome[],
        initialGeneration = 1,
        backend: ActiveTrainingBackend = "wasm-scalar",
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
        )
    }

    private constructor(
        exports: TrainingWasmExports,
        topology: Topology,
        config: TrainingEngineConfig,
        initialPopulation: Genome[] | undefined,
        initialGeneration: number,
        backend: ActiveTrainingBackend,
    ) {
        const startedAt = performance.now()
        this.exports = exports
        this.topology = topology
        this.config = config
        this.backend = backend
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
        const generation = summary[0]
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
        const stride = this.muscleIds.length * 3
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
        }
    }

    private createInput(initialPopulation: Genome[] | undefined, initialGeneration: number): Float32Array {
        const particleIds = new Map(this.topology.particles.map((particle, index) => [particle.id, index]))
        const constraintCount = this.topology.constraints.length + this.topology.muscles.length
        const genomeLength = this.populationSize * this.muscleIds.length * 3
        const values = new Float32Array(
            14 + this.particleCount * 6 + constraintCount * 5 + genomeLength,
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
        ])
        let cursor = 14
        for (const particle of this.topology.particles) {
            values.set([
                particle.initialPos.x,
                particle.initialPos.y,
                particle.mass,
                particle.radius,
                particle.isLocked ? 1 : 0,
                particle.isHead || particle.id === "head" ? 1 : 0,
            ], cursor)
            cursor += 6
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
        const random = new SeededRandom(this.config.seed)
        for (let creature = 0; creature < this.populationSize; creature++) {
            for (let muscle = 0; muscle < this.muscleIds.length; muscle++) {
                const gene = initialPopulation?.[creature]?.genes.find((candidate) => candidate.muscleId === this.muscleIds[muscle])
                values[cursor++] = gene?.amplitude ?? random.next() * 0.5 + 0.1
                values[cursor++] = gene?.frequency ?? random.next() * 2 + 0.1
                values[cursor++] = gene?.phase ?? random.next() * Math.PI * 2
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
            amplitude: values[muscle * 3],
            frequency: values[muscle * 3 + 1],
            phase: values[muscle * 3 + 2],
        }))
        return { id, genes, generation, createdAt: Date.now() }
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
