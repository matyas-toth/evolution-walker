import type {
    Genome,
    MuscleGene,
    Topology,
    TrainingEngineConfig,
    TrainingEngineState,
    TrainingSnapshot,
    TrainingStageTimings,
} from "@/core/types"
import type { EvaluatedGeneration, TrainingBackendEngine } from "./engineBackend"

const GPU_MAP_READ = 0x0001
const GPU_COPY_SRC = 0x0004
const GPU_COPY_DST = 0x0008
const GPU_STORAGE = 0x0080
const WORKGROUP_SIZE = 64

interface GpuBufferHandle {
    mapAsync(mode: number): Promise<void>
    getMappedRange(): ArrayBuffer
    unmap(): void
}

interface GpuDeviceHandle {
    queue: {
        writeBuffer(buffer: GpuBufferHandle, offset: number, data: ArrayBufferView): void
        submit(commands: unknown[]): void
        onSubmittedWorkDone(): Promise<void>
    }
    lost: Promise<{ message: string }>
    createBuffer(descriptor: { size: number; usage: number }): GpuBufferHandle
    createShaderModule(descriptor: { code: string }): unknown
    createComputePipelineAsync(descriptor: unknown): Promise<{ getBindGroupLayout(index: number): unknown }>
    createBindGroup(descriptor: unknown): unknown
    createCommandEncoder(): {
        beginComputePass(): {
            setPipeline(pipeline: unknown): void
            setBindGroup(index: number, bindGroup: unknown): void
            dispatchWorkgroups(count: number): void
            end(): void
        }
        copyBufferToBuffer(source: GpuBufferHandle, sourceOffset: number, target: GpuBufferHandle, targetOffset: number, size: number): void
        finish(): unknown
    }
}

interface WorkerGpuNavigator extends WorkerNavigator {
    gpu?: {
        requestAdapter(options: { powerPreference: "high-performance" }): Promise<{
            requestDevice(): Promise<GpuDeviceHandle>
        } | null>
    }
}

/** Deterministic xorshift stream used for GPU-side population initialization and evolution. */
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

const TRAINING_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> state: array<f32>;
@group(0) @binding(1) var<storage, read> particle_defs: array<f32>;
@group(0) @binding(2) var<storage, read> constraints: array<f32>;
@group(0) @binding(3) var<storage, read> genomes: array<f32>;
@group(0) @binding(4) var<storage, read_write> metrics: array<f32>;
@group(0) @binding(5) var<storage, read> params: array<f32>;
@group(0) @binding(6) var<storage, read_write> oscillators: array<f32>;

const PI2: f32 = 6.283185307179586;
const DT: f32 = 0.016666667;

@compute @workgroup_size(64)
fn train(@builtin(global_invocation_id) id: vec3<u32>) {
    let creature = id.x;
    let population = u32(params[0]);
    if (creature >= population) { return; }
    let particle_count = u32(params[1]);
    let constraint_count = u32(params[2]);
    let muscle_count = u32(params[3]);
    let step_count = u32(params[4]);
    let current_step = u32(params[5]);
    let total_steps = u32(params[6]);
    let ground_y = params[7];
    let spawn_x = params[8];
    let spawn_y = params[9];
    let target_distance = params[10];
    let head_index = u32(params[11]);
    let state_base = creature * particle_count * 4u;
    let metric_base = creature * 8u;
    let oscillator_base = creature * muscle_count * 4u;

    if (current_step == 0u) {
        metrics[metric_base + 0u] = spawn_x;
        metrics[metric_base + 1u] = spawn_y;
        metrics[metric_base + 2u] = spawn_x;
        metrics[metric_base + 3u] = ground_y;
        metrics[metric_base + 4u] = 1.0;
        metrics[metric_base + 5u] = 0.0;
        metrics[metric_base + 6u] = 0.0;
        for (var particle = 0u; particle < particle_count; particle++) {
            let state_index = state_base + particle * 4u;
            let definition = particle * 6u;
            let x = spawn_x + particle_defs[definition];
            let y = spawn_y + particle_defs[definition + 1u];
            state[state_index] = x;
            state[state_index + 1u] = y;
            state[state_index + 2u] = x;
            state[state_index + 3u] = y;
        }
        for (var muscle = 0u; muscle < muscle_count; muscle++) {
            let genome = (creature * muscle_count + muscle) * 3u;
            let oscillator = oscillator_base + muscle * 4u;
            let phase = genomes[genome + 2u];
            let delta = PI2 * genomes[genome + 1u] * DT;
            oscillators[oscillator] = sin(phase);
            oscillators[oscillator + 1u] = cos(phase);
            oscillators[oscillator + 2u] = sin(delta);
            oscillators[oscillator + 3u] = cos(delta);
        }
    }

    for (var local_step = 0u; local_step < step_count; local_step++) {
        if (metrics[metric_base + 4u] == 0.0) { break; }
        for (var particle = 0u; particle < particle_count; particle++) {
            let definition = particle * 6u;
            if (particle_defs[definition + 4u] != 0.0) { continue; }
            let index = state_base + particle * 4u;
            let x = state[index];
            let y = state[index + 1u];
            let velocity_x = (x - state[index + 2u]) * 0.98;
            let velocity_y = (y - state[index + 3u]) * 0.98;
            state[index + 2u] = x;
            state[index + 3u] = y;
            state[index] = x + velocity_x;
            state[index + 1u] = y + velocity_y + (200.0 / max(0.0001, particle_defs[definition + 2u])) * DT * DT;
        }

        for (var iteration = 0u; iteration < 3u; iteration++) {
            for (var constraint = 0u; constraint < constraint_count; constraint++) {
                let definition = constraint * 5u;
                let p1 = u32(constraints[definition]);
                let p2 = u32(constraints[definition + 1u]);
                let p1_index = state_base + p1 * 4u;
                let p2_index = state_base + p2 * 4u;
                let dx = state[p2_index] - state[p1_index];
                let dy = state[p2_index + 1u] - state[p1_index + 1u];
                let distance = sqrt(dx * dx + dy * dy);
                if (distance <= 0.00001) { continue; }
                var target_length = constraints[definition + 2u];
                let muscle = i32(constraints[definition + 4u]);
                if (muscle >= 0) {
                    let muscle_index = u32(muscle);
                    let genome = (creature * muscle_count + muscle_index) * 3u;
                    let oscillator = oscillator_base + muscle_index * 4u;
                    target_length *= 1.0 + genomes[genome] * oscillators[oscillator];
                }
                let scale = (distance - target_length) * constraints[definition + 3u] / distance;
                let correction_x = dx * scale;
                let correction_y = dy * scale;
                let mass1 = particle_defs[p1 * 6u + 2u];
                let mass2 = particle_defs[p2 * 6u + 2u];
                let total_mass = mass1 + mass2;
                if (particle_defs[p1 * 6u + 4u] == 0.0) {
                    state[p1_index] += correction_x * mass2 / total_mass;
                    state[p1_index + 1u] += correction_y * mass2 / total_mass;
                }
                if (particle_defs[p2 * 6u + 4u] == 0.0) {
                    state[p2_index] -= correction_x * mass1 / total_mass;
                    state[p2_index + 1u] -= correction_y * mass1 / total_mass;
                }
            }
        }

        var total_mass = 0.0;
        var weighted_x = 0.0;
        var weighted_y = 0.0;
        for (var particle = 0u; particle < particle_count; particle++) {
            let definition = particle * 6u;
            let index = state_base + particle * 4u;
            let radius = particle_defs[definition + 3u];
            let maximum_y = ground_y - radius;
            if (state[index + 1u] > maximum_y) {
                let velocity_x = state[index] - state[index + 2u];
                let velocity_y = state[index + 1u] - state[index + 3u];
                state[index + 1u] = maximum_y;
                state[index + 3u] = maximum_y + velocity_y * 0.3;
                state[index + 2u] = state[index] - velocity_x * 0.7;
            }
            if (state[index] < radius) {
                state[index] = radius;
                state[index + 2u] = radius;
            }
            let mass = particle_defs[definition + 2u];
            total_mass += mass;
            weighted_x += state[index] * mass;
            weighted_y += state[index + 1u] * mass;
            if (metrics[metric_base + 5u] == 0.0 && state[index] >= target_distance && state[index] <= target_distance + 100.0 && state[index + 1u] >= ground_y - 100.0 && state[index + 1u] <= ground_y - 20.0) {
                metrics[metric_base + 5u] = 1.0;
            }
        }
        let center_x = weighted_x / total_mass;
        let center_y = weighted_y / total_mass;
        metrics[metric_base] = center_x;
        metrics[metric_base + 1u] = center_y;
        metrics[metric_base + 2u] = max(metrics[metric_base + 2u], center_x);
        let head_y = state[state_base + head_index * 4u + 1u];
        metrics[metric_base + 3u] = min(metrics[metric_base + 3u], head_y);
        if (head_y >= ground_y - particle_defs[head_index * 6u + 3u]) {
            metrics[metric_base + 4u] = 0.0;
        }
        for (var muscle = 0u; muscle < muscle_count; muscle++) {
            let oscillator = oscillator_base + muscle * 4u;
            let sine = oscillators[oscillator];
            let cosine = oscillators[oscillator + 1u];
            let delta_sine = oscillators[oscillator + 2u];
            let delta_cosine = oscillators[oscillator + 3u];
            oscillators[oscillator] = sine * delta_cosine + cosine * delta_sine;
            oscillators[oscillator + 1u] = cosine * delta_cosine - sine * delta_sine;
        }
    }

    if (current_step + step_count >= total_steps) {
        let distance = metrics[metric_base + 2u] - spawn_x;
        let target_center = target_distance + 50.0;
        let target_range = max(1.0, abs(target_distance - spawn_x));
        let target_bonus = select(max(0.0, 1.0 - abs(metrics[metric_base] - target_center) / target_range) * 500.0, 1000.0, metrics[metric_base + 5u] != 0.0);
        let upright = 50.0 * max(0.0, (ground_y - metrics[metric_base + 3u]) / ground_y);
        let death = select(-500.0, 0.0, metrics[metric_base + 4u] != 0.0);
        metrics[metric_base + 6u] = distance + target_bonus + upright + death;
    }
}
`

/** WebGPU backend that keeps simulation slabs resident and parallelizes across creatures. */
export class WebGpuTrainingEngine implements TrainingBackendEngine {
    private readonly device: GpuDeviceHandle
    private readonly pipeline: { getBindGroupLayout(index: number): unknown }
    private readonly bindGroup: unknown
    private readonly topology: Topology
    private config: TrainingEngineConfig
    private readonly muscleIds: string[]
    private readonly random: SeededRandom
    private readonly genomes: Float32Array
    private readonly state: Float32Array
    private readonly metrics: Float32Array
    private readonly stateBuffer: GpuBufferHandle
    private readonly genomeBuffer: GpuBufferHandle
    private readonly metricsBuffer: GpuBufferHandle
    private readonly paramsBuffer: GpuBufferHandle
    private readonly stateReadBuffer: GpuBufferHandle
    private readonly metricsReadBuffer: GpuBufferHandle
    private readonly timings: TrainingStageTimings
    private readonly generationDurations: number[] = []
    private currentStep = 0
    private generation: number
    private generationStartedAt = performance.now()
    private bestFitness = Number.NEGATIVE_INFINITY
    private bestGenomeValues: Float32Array | null = null
    private lastEvaluation: EvaluatedGeneration | null = null
    private deviceLost = false

    static async create(topology: Topology, config: TrainingEngineConfig, initialPopulation?: Genome[], initialGeneration = 1): Promise<WebGpuTrainingEngine> {
        const gpu = (navigator as WorkerGpuNavigator).gpu
        if (!gpu) throw new Error("WebGPU is not exposed in this worker")
        const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" })
        if (!adapter) throw new Error("No high-performance WebGPU adapter is available")
        const device = await adapter.requestDevice()
        const module = device.createShaderModule({ code: TRAINING_SHADER })
        const compilation = await (module as {
            getCompilationInfo(): Promise<{ messages: Array<{ type: string; lineNum: number; message: string }> }>
        }).getCompilationInfo()
        const shaderErrors = compilation.messages.filter((message) => message.type === "error")
        if (shaderErrors.length) {
            throw new Error(shaderErrors.slice(0, 3).map((message) => `WGSL ${message.lineNum}: ${message.message}`).join(" | "))
        }
        const pipeline = await device.createComputePipelineAsync({
            layout: "auto",
            compute: { module, entryPoint: "train" },
        })
        return new WebGpuTrainingEngine(device, pipeline, topology, config, initialPopulation, initialGeneration)
    }

    private constructor(device: GpuDeviceHandle, pipeline: { getBindGroupLayout(index: number): unknown }, topology: Topology, config: TrainingEngineConfig, initialPopulation: Genome[] | undefined, initialGeneration: number) {
        const startedAt = performance.now()
        this.device = device
        this.pipeline = pipeline
        this.topology = topology
        this.config = config
        this.generation = initialGeneration
        this.muscleIds = topology.muscles.map((muscle) => muscle.id)
        this.random = new SeededRandom(config.seed)
        this.genomes = this.createGenomes(initialPopulation)
        this.state = new Float32Array(config.populationSize * topology.particles.length * 4)
        this.metrics = new Float32Array(config.populationSize * 8)
        const particleDefinitions = this.createParticleDefinitions()
        const constraints = this.createConstraints()
        const oscillators = new Float32Array(Math.max(1, config.populationSize * topology.muscles.length * 4))
        const params = new Float32Array(16)
        this.stateBuffer = this.createBuffer(this.state, GPU_STORAGE | GPU_COPY_SRC)
        const particleBuffer = this.createBuffer(particleDefinitions, GPU_STORAGE)
        const constraintBuffer = this.createBuffer(constraints, GPU_STORAGE)
        this.genomeBuffer = this.createBuffer(this.genomes, GPU_STORAGE | GPU_COPY_DST)
        this.metricsBuffer = this.createBuffer(this.metrics, GPU_STORAGE | GPU_COPY_SRC)
        this.paramsBuffer = this.createBuffer(params, GPU_STORAGE | GPU_COPY_DST)
        const oscillatorBuffer = this.createBuffer(oscillators, GPU_STORAGE)
        this.stateReadBuffer = device.createBuffer({ size: this.state.byteLength, usage: GPU_MAP_READ | GPU_COPY_DST })
        this.metricsReadBuffer = device.createBuffer({ size: this.metrics.byteLength, usage: GPU_MAP_READ | GPU_COPY_DST })
        this.bindGroup = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [this.stateBuffer, particleBuffer, constraintBuffer, this.genomeBuffer, this.metricsBuffer, this.paramsBuffer, oscillatorBuffer]
                .map((buffer, binding) => ({ binding, resource: { buffer } })),
        })
        this.timings = { initializeMs: performance.now() - startedAt, simulationMs: 0, fitnessMs: 0, evolutionMs: 0, resetMs: 0, transferMs: 0, totalGenerationMs: 0 }
        void device.lost.then(() => { this.deviceLost = true })
    }

    updateConfig(config: TrainingEngineConfig): void { this.config = config }
    getGeneration(): number { return this.generation }
    getProgress(): number { return this.currentStep / Math.max(1, Math.round(this.config.generationDuration * 60)) * 100 }

    async runChunk(maxSteps: number): Promise<boolean> {
        if (this.deviceLost) throw new Error("WebGPU device was lost")
        if (this.currentStep === 0) this.timings.simulationMs = 0
        const totalSteps = Math.max(1, Math.round(this.config.generationDuration * 60))
        const stepCount = Math.min(maxSteps * 10, totalSteps - this.currentStep)
        const params = new Float32Array([
            this.config.populationSize, this.topology.particles.length,
            this.topology.constraints.length + this.topology.muscles.length,
            this.topology.muscles.length, stepCount, this.currentStep, totalSteps,
            600, 100, 570, this.config.targetDistance, this.headIndex(),
        ])
        const startedAt = performance.now()
        if (this.currentStep === 0) this.device.queue.writeBuffer(this.genomeBuffer, 0, this.genomes)
        this.device.queue.writeBuffer(this.paramsBuffer, 0, params)
        const encoder = this.device.createCommandEncoder()
        const pass = encoder.beginComputePass()
        pass.setPipeline(this.pipeline)
        pass.setBindGroup(0, this.bindGroup)
        pass.dispatchWorkgroups(Math.ceil(this.config.populationSize / WORKGROUP_SIZE))
        pass.end()
        const completed = this.currentStep + stepCount >= totalSteps
        if (completed) {
            encoder.copyBufferToBuffer(this.stateBuffer, 0, this.stateReadBuffer, 0, this.state.byteLength)
            encoder.copyBufferToBuffer(this.metricsBuffer, 0, this.metricsReadBuffer, 0, this.metrics.byteLength)
        }
        this.device.queue.submit([encoder.finish()])
        if (completed) await this.readGenerationBuffers()
        else await this.device.queue.onSubmittedWorkDone()
        this.currentStep += stepCount
        this.timings.simulationMs += performance.now() - startedAt
        return completed
    }

    finishGeneration(): EvaluatedGeneration {
        const startedAt = performance.now()
        let bestIndex = 0
        let bestFitness = Number.NEGATIVE_INFINITY
        let totalFitness = 0
        let targetIndex = -1
        for (let creature = 0; creature < this.config.populationSize; creature++) {
            const fitness = this.metrics[creature * 8 + 6]
            totalFitness += fitness
            if (fitness > bestFitness) { bestFitness = fitness; bestIndex = creature }
            if (targetIndex < 0 && this.metrics[creature * 8 + 5] !== 0) targetIndex = creature
        }
        const stride = this.muscleIds.length * 3
        const bestValues = this.genomes.slice(bestIndex * stride, (bestIndex + 1) * stride)
        const targetValues = targetIndex >= 0
            ? this.genomes.slice(targetIndex * stride, (targetIndex + 1) * stride)
            : null
        if (bestFitness > this.bestFitness) { this.bestFitness = bestFitness; this.bestGenomeValues = bestValues.slice() }
        this.timings.fitnessMs = performance.now() - startedAt
        const evolutionStarted = performance.now()
        this.evolve()
        this.timings.evolutionMs = performance.now() - evolutionStarted
        this.timings.resetMs = 0
        this.timings.totalGenerationMs = performance.now() - this.generationStartedAt
        this.generationDurations.push(this.timings.totalGenerationMs)
        if (this.generationDurations.length > 30) this.generationDurations.shift()
        const evaluatedGeneration = this.generation
        this.generation++
        this.currentStep = 0
        this.generationStartedAt = performance.now()
        this.lastEvaluation = {
            generation: evaluatedGeneration,
            bestFitness,
            averageFitness: totalFitness / this.config.populationSize,
            bestIndex,
            targetIndex,
            bestGenome: this.materializeGenome(bestValues, `genome-${evaluatedGeneration}-best`, evaluatedGeneration),
            targetGenome: targetValues ? this.materializeGenome(targetValues, `genome-${evaluatedGeneration}-target`, evaluatedGeneration) : null,
        }
        return this.lastEvaluation
    }

    getSnapshot(phase: TrainingSnapshot["phase"], includeRender: boolean): TrainingSnapshot {
        const averageDuration = this.generationDurations.length ? this.generationDurations.reduce((sum, value) => sum + value, 0) / this.generationDurations.length : 0
        return {
            phase, generation: this.generation, progress: Math.round(this.getProgress()),
            bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : 0,
            averageFitness: this.lastEvaluation?.averageFitness ?? 0,
            diagnostics: {
                backend: "webgpu", workerCount: 1,
                generationsPerSecond: averageDuration ? 1000 / averageDuration : 0,
                stageTimings: { ...this.timings }, droppedSnapshots: 0,
                memoryBytes: this.state.byteLength + this.metrics.byteLength + this.genomes.byteLength,
            },
            render: includeRender ? this.createRenderSnapshot(5) : undefined,
        }
    }

    getBestGenome(): Genome | null {
        return this.bestGenomeValues ? this.materializeGenome(this.bestGenomeValues, `genome-best-${this.generation}`, this.generation) : null
    }

    exportState(): TrainingEngineState {
        const stride = this.muscleIds.length * 3
        return {
            population: Array.from({ length: this.config.populationSize }, (_, creature) => this.materializeGenome(this.genomes.slice(creature * stride, (creature + 1) * stride), `genome-${this.generation}-${creature}`, this.generation)),
            bestGenome: this.getBestGenome(), bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : 0, generation: this.generation,
        }
    }

    private createBuffer(data: Float32Array, usage: number): GpuBufferHandle {
        const buffer = this.device.createBuffer({ size: Math.max(4, data.byteLength), usage: usage | GPU_COPY_DST })
        if (data.byteLength) this.device.queue.writeBuffer(buffer, 0, data)
        return buffer
    }

    private async readGenerationBuffers(): Promise<void> {
        const startedAt = performance.now()
        await Promise.all([this.stateReadBuffer.mapAsync(GPU_MAP_READ), this.metricsReadBuffer.mapAsync(GPU_MAP_READ)])
        this.state.set(new Float32Array(this.stateReadBuffer.getMappedRange()).subarray(0, this.state.length))
        this.metrics.set(new Float32Array(this.metricsReadBuffer.getMappedRange()).subarray(0, this.metrics.length))
        this.stateReadBuffer.unmap()
        this.metricsReadBuffer.unmap()
        this.timings.transferMs = performance.now() - startedAt
    }

    private createGenomes(initialPopulation?: Genome[]): Float32Array {
        const values = new Float32Array(this.config.populationSize * this.muscleIds.length * 3)
        for (let creature = 0; creature < this.config.populationSize; creature++) for (let muscle = 0; muscle < this.muscleIds.length; muscle++) {
            const gene = initialPopulation?.[creature]?.genes.find((candidate) => candidate.muscleId === this.muscleIds[muscle])
            const index = (creature * this.muscleIds.length + muscle) * 3
            values[index] = gene?.amplitude ?? this.random.next() * 0.5 + 0.1
            values[index + 1] = gene?.frequency ?? this.random.next() * 2 + 0.1
            values[index + 2] = gene?.phase ?? this.random.next() * Math.PI * 2
        }
        return values
    }

    private createParticleDefinitions(): Float32Array {
        const values = new Float32Array(this.topology.particles.length * 6)
        this.topology.particles.forEach((particle, index) => values.set([particle.initialPos.x, particle.initialPos.y, particle.mass, particle.radius, particle.isLocked ? 1 : 0, particle.isHead || particle.id === "head" ? 1 : 0], index * 6))
        return values
    }

    private createConstraints(): Float32Array {
        const ids = new Map(this.topology.particles.map((particle, index) => [particle.id, index]))
        const values = new Float32Array((this.topology.constraints.length + this.topology.muscles.length) * 5)
        let cursor = 0
        for (const constraint of this.topology.constraints) { values.set([ids.get(constraint.p1Id) ?? 0, ids.get(constraint.p2Id) ?? 0, constraint.restLength, constraint.stiffness, -1], cursor); cursor += 5 }
        this.topology.muscles.forEach((muscle, index) => { values.set([ids.get(muscle.p1Id) ?? 0, ids.get(muscle.p2Id) ?? 0, muscle.baseLength, 0.9, index], cursor); cursor += 5 })
        return values
    }

    private headIndex(): number { return Math.max(0, this.topology.particles.findIndex((particle) => particle.isHead || particle.id === "head")) }

    private evolve(): void {
        const population = this.config.populationSize
        const stride = this.muscleIds.length * 3
        const ranked = Array.from({ length: population }, (_, index) => index).sort((left, right) => this.metrics[right * 8 + 6] - this.metrics[left * 8 + 6])
        const parentCount = Math.max(1, Math.min(population, Math.floor(population * this.config.parentsTopPercent)))
        const next = new Float32Array(this.genomes.length)
        const tournament = () => {
            let best = ranked[Math.floor(this.random.next() * parentCount)]
            for (let round = 1; round < 3; round++) { const candidate = ranked[Math.floor(this.random.next() * parentCount)]; if (this.metrics[candidate * 8 + 6] > this.metrics[best * 8 + 6]) best = candidate }
            return best
        }
        for (let child = 0; child < population; child++) {
            if (child < Math.min(population, this.config.elitismCount)) { const source = ranked[child]; next.set(this.genomes.subarray(source * stride, (source + 1) * stride), child * stride); continue }
            const parent1 = tournament(); const parent2 = tournament(); const bias = this.metrics[parent1 * 8 + 6] >= this.metrics[parent2 * 8 + 6] ? 0.6 : 0.4
            for (let value = 0; value < stride; value++) {
                const source = this.random.next() < bias ? parent1 : parent2
                let result = this.genomes[source * stride + value]
                if (this.random.next() <= this.config.mutationRate) { result *= 1 + (this.random.next() - 0.5) * 2 * this.config.mutationStrength; result = value % 3 === 0 ? Math.max(0.05, Math.min(0.8, result)) : value % 3 === 1 ? Math.max(0.1, Math.min(5, result)) : Math.max(0, Math.min(Math.PI * 2, result)) }
                next[child * stride + value] = result
            }
        }
        this.genomes.set(next)
    }

    private materializeGenome(values: Float32Array, id: string, generation: number): Genome {
        const genes: MuscleGene[] = this.muscleIds.map((muscleId, muscle) => ({ muscleId, amplitude: values[muscle * 3], frequency: values[muscle * 3 + 1], phase: values[muscle * 3 + 2] }))
        return { id, genes, generation, createdAt: Date.now() }
    }

    private createRenderSnapshot(maximum: number): TrainingSnapshot["render"] {
        const ranked = Array.from({ length: this.config.populationSize }, (_, index) => index).sort((left, right) => this.metrics[right * 8] - this.metrics[left * 8])
        const creatureCount = Math.min(maximum, this.config.populationSize)
        const particleCount = this.topology.particles.length
        const positions = new Float32Array(creatureCount * particleCount * 2)
        const centers = new Float32Array(creatureCount * 2)
        for (let output = 0; output < creatureCount; output++) { const creature = ranked[output]; centers[output * 2] = this.metrics[creature * 8]; centers[output * 2 + 1] = this.metrics[creature * 8 + 1]; for (let particle = 0; particle < particleCount; particle++) { const source = (creature * particleCount + particle) * 4; const target = (output * particleCount + particle) * 2; positions[target] = this.state[source]; positions[target + 1] = this.state[source + 1] } }
        return { creatureCount, particleCount, positions, centers }
    }
}
