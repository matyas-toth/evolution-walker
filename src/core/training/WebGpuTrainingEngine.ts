import type {
    Genome,
    MuscleGene,
    PackedTrainingReplay,
    Topology,
    TrainingEngineConfig,
    TrainingEngineState,
    TrainingSnapshot,
    TrainingStageTimings,
    EvolutionPolicyState,
} from "@/core/types"
import { selectTopIndices, type EvaluatedGeneration, type TrainingBackendEngine } from "./engineBackend"
import { getTrainingTargetZone, TRAINING_FRAME_RATE, TRAINING_GROUND_Y } from "./world"
import { analyzeLocomotion, type LocomotionAnalysis } from "@/core/topology/locomotion"
import { CandidateMetricOffset, CANDIDATE_METRIC_STRIDE, EvolutionPolicyV3 } from "./EvolutionPolicyV3"

const GPU_MAP_READ = 0x0001
const GPU_COPY_SRC = 0x0004
const GPU_COPY_DST = 0x0008
const GPU_STORAGE = 0x0080
const WORKGROUP_SIZE = 64

interface GpuBufferHandle {
    mapAsync(mode: number): Promise<void>
    getMappedRange(): ArrayBuffer
    unmap(): void
    destroy(): void
}

interface GpuDeviceHandle {
    queue: {
        writeBuffer(buffer: GpuBufferHandle, offset: number, data: ArrayBufferView): void
        submit(commands: unknown[]): void
        onSubmittedWorkDone(): Promise<void>
    }
    lost: Promise<{ message: string }>
    destroy(): void
    destroy(): void
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
@group(0) @binding(7) var<storage, read_write> replay_positions: array<f32>;

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
    let metric_base = creature * 15u;
    let oscillator_base = creature * muscle_count * 4u;
    let replay_meta_index = (total_steps + 1u) * particle_count * 2u;

    if (current_step == 0u) {
        metrics[metric_base + 0u] = spawn_x;
        metrics[metric_base + 1u] = spawn_y;
        metrics[metric_base + 2u] = spawn_x;
        metrics[metric_base + 3u] = ground_y;
        metrics[metric_base + 4u] = 1.0;
        metrics[metric_base + 5u] = 0.0;
        metrics[metric_base + 6u] = 0.0;
        metrics[metric_base + 7u] = 0.0;
        metrics[metric_base + 8u] = 0.0;
        metrics[metric_base + 9u] = 0.0;
        metrics[metric_base + 10u] = 0.0;
        metrics[metric_base + 11u] = 0.0;
        metrics[metric_base + 12u] = -6.0;
        metrics[metric_base + 13u] = 0.0;
        metrics[metric_base + 14u] = -1.0;
        for (var particle = 0u; particle < particle_count; particle++) {
            let state_index = state_base + particle * 4u;
            let definition = particle * 7u;
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
        if (params[12] != 0.0 && creature == 0u) {
            replay_positions[replay_meta_index] = -1.0;
            for (var particle = 0u; particle < particle_count; particle++) {
                let state_index = state_base + particle * 4u;
                let replay_index = particle * 2u;
                replay_positions[replay_index] = state[state_index];
                replay_positions[replay_index + 1u] = state[state_index + 1u];
            }
        }
    }

    for (var local_step = 0u; local_step < step_count; local_step++) {
        if (metrics[metric_base + 4u] == 0.0) { break; }
        for (var particle = 0u; particle < particle_count; particle++) {
            let definition = particle * 7u;
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
                let mass1 = particle_defs[p1 * 7u + 2u];
                let mass2 = particle_defs[p2 * 7u + 2u];
                let total_mass = mass1 + mass2;
                if (particle_defs[p1 * 7u + 4u] == 0.0) {
                    state[p1_index] += correction_x * mass2 / total_mass;
                    state[p1_index + 1u] += correction_y * mass2 / total_mass;
                }
                if (particle_defs[p2 * 7u + 4u] == 0.0) {
                    state[p2_index] -= correction_x * mass1 / total_mass;
                    state[p2_index + 1u] -= correction_y * mass1 / total_mass;
                }
            }
        }

        var total_mass = 0.0;
        var weighted_x = 0.0;
        var weighted_y = 0.0;
        var contact_mask = 0u;
        for (var particle = 0u; particle < particle_count; particle++) {
            let definition = particle * 7u;
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
            if (metrics[metric_base + 5u] == 0.0 && state[index] >= target_distance && state[index] <= target_distance + 100.0 && state[index + 1u] >= ground_y - 100.0 && state[index + 1u] <= ground_y - 20.0) {
                metrics[metric_base + 5u] = 1.0;
                metrics[metric_base + 14u] = f32(current_step + local_step);
            }
            let mass = particle_defs[definition + 2u];
            total_mass += mass;
            weighted_x += state[index] * mass;
            weighted_y += state[index + 1u] * mass;
            let support_group = u32(particle_defs[definition + 6u]);
            if (support_group > 0u && support_group <= 24u && state[index + 1u] >= maximum_y - 1.0) {
                contact_mask |= 1u << (support_group - 1u);
            }
        }
        let center_x = weighted_x / total_mass;
        let center_y = weighted_y / total_mass;
        metrics[metric_base] = center_x;
        metrics[metric_base + 1u] = center_y;
        metrics[metric_base + 2u] = max(metrics[metric_base + 2u], center_x);
        let head_y = state[state_base + head_index * 4u + 1u];
        metrics[metric_base + 3u] = min(metrics[metric_base + 3u], head_y);
        if (head_y >= ground_y - particle_defs[head_index * 7u + 3u]) {
            metrics[metric_base + 4u] = 0.0;
        } else {
            metrics[metric_base + 7u] += 1.0;
            metrics[metric_base + 8u] += max(0.0, ground_y - head_y);
            if (contact_mask == 0u) { metrics[metric_base + 9u] += 1.0; }
            let absolute_step = current_step + local_step;
            if (contact_mask != 0u && (contact_mask & (contact_mask - 1u)) == 0u) {
                let previous_grounded = u32(metrics[metric_base + 13u]);
                if (previous_grounded != 0u && previous_grounded != contact_mask && f32(absolute_step) - metrics[metric_base + 12u] >= 6.0) {
                    metrics[metric_base + 10u] += 1.0;
                    metrics[metric_base + 12u] = f32(absolute_step);
                }
                metrics[metric_base + 13u] = f32(contact_mask);
            }
            metrics[metric_base + 11u] = f32(contact_mask);
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
        if (params[12] != 0.0 && creature == 0u) {
            let replay_frame = current_step + local_step + 1u;
            for (var particle = 0u; particle < particle_count; particle++) {
                let state_index = state_base + particle * 4u;
                let replay_index = (replay_frame * particle_count + particle) * 2u;
                replay_positions[replay_index] = state[state_index];
                replay_positions[replay_index + 1u] = state[state_index + 1u];
            }
            if (metrics[metric_base + 5u] != 0.0 && replay_positions[replay_meta_index] < 0.0) {
                replay_positions[replay_meta_index] = f32(replay_frame);
                break;
            }
        }
    }

    if (current_step + step_count >= total_steps) {
        let target_range = max(1.0, target_distance - spawn_x);
        let distance = clamp(metrics[metric_base + 2u] - spawn_x, 0.0, target_range);
        let progress = distance / target_range;
        let survival = clamp(metrics[metric_base + 7u] / max(1.0, f32(total_steps)), 0.0, 1.0);
        let upright = clamp(metrics[metric_base + 8u] / max(1.0, metrics[metric_base + 7u]) / max(1.0, params[13]), 0.0, 1.0);
        let gait_rate = clamp(metrics[metric_base + 10u] / max(DT, f32(total_steps) * DT), 0.0, 2.0);
        let airborne = clamp(metrics[metric_base + 9u] / max(1.0, metrics[metric_base + 7u]), 0.0, 1.0);
        metrics[metric_base + 6u] = distance + 250.0 * sqrt(progress)
            + 120.0 * survival * (0.25 + 0.75 * upright)
            + 80.0 * gait_rate * sqrt(progress)
            - 60.0 * clamp((airborne - 0.35) / 0.65, 0.0, 1.0)
            - 100.0 * (1.0 - survival)
            + select(0.0, 1000.0, metrics[metric_base + 5u] != 0.0);
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
    private readonly locomotion: LocomotionAnalysis
    private genomes: Float32Array
    private state: Float32Array
    private metrics: Float32Array
    private readonly stateBuffer: GpuBufferHandle
    private readonly genomeBuffer: GpuBufferHandle
    private readonly metricsBuffer: GpuBufferHandle
    private readonly paramsBuffer: GpuBufferHandle
    private readonly stateReadBuffer: GpuBufferHandle
    private readonly metricsReadBuffer: GpuBufferHandle
    private replayPositions: Float32Array
    private readonly replayPositionsBuffer: GpuBufferHandle
    private readonly replayPositionsReadBuffer: GpuBufferHandle
    private readonly replayMode: boolean
    private readonly timings: TrainingStageTimings
    private readonly generationDurations: number[] = []
    private currentStep = 0
    private generation: number
    private generationStartedAt = performance.now()
    private bestFitness = Number.NEGATIVE_INFINITY
    private bestGenomeValues: Float32Array | null = null
    private lastEvaluation: EvaluatedGeneration | null = null
    private deviceLost = false
    private readonly policy: EvolutionPolicyV3
    private readonly buffers: GpuBufferHandle[] = []
    private disposed = false
    private gpuBufferBytes = 0

    static async create(topology: Topology, config: TrainingEngineConfig, initialPopulation?: Genome[], initialGeneration = 1, replayMode = false, policyState?: EvolutionPolicyState): Promise<WebGpuTrainingEngine> {
        const gpu = (navigator as WorkerGpuNavigator).gpu
        if (!gpu) throw new Error("WebGPU is not exposed in this worker")
        const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" })
        if (!adapter) throw new Error("No high-performance WebGPU adapter is available")
        const device = await adapter.requestDevice()
        try {
            const shaderModule = device.createShaderModule({ code: TRAINING_SHADER })
            const compilation = await (shaderModule as {
                getCompilationInfo(): Promise<{ messages: Array<{ type: string; lineNum: number; message: string }> }>
            }).getCompilationInfo()
            const shaderErrors = compilation.messages.filter((message) => message.type === "error")
            if (shaderErrors.length) {
                throw new Error(shaderErrors.slice(0, 3).map((message) => `WGSL ${message.lineNum}: ${message.message}`).join(" | "))
            }
            const pipeline = await device.createComputePipelineAsync({
                layout: "auto",
                compute: { module: shaderModule, entryPoint: "train" },
            })
            return new WebGpuTrainingEngine(device, pipeline, topology, config, initialPopulation, initialGeneration, replayMode, policyState)
        } catch (error) {
            device.destroy()
            throw error
        }
    }

    private constructor(device: GpuDeviceHandle, pipeline: { getBindGroupLayout(index: number): unknown }, topology: Topology, config: TrainingEngineConfig, initialPopulation: Genome[] | undefined, initialGeneration: number, replayMode: boolean, policyState?: EvolutionPolicyState) {
        const startedAt = performance.now()
        this.device = device
        this.pipeline = pipeline
        this.topology = topology
        this.locomotion = analyzeLocomotion(topology)
        this.config = config
        this.replayMode = replayMode
        this.generation = initialGeneration
        this.muscleIds = topology.muscles.map((muscle) => muscle.id)
        this.random = new SeededRandom(config.seed)
        this.policy = new EvolutionPolicyV3(topology, config, policyState)
        const restoredChampion = this.policy.getChampionGenome(initialGeneration)
        this.genomes = this.createGenomes(initialPopulation)
        if (restoredChampion) {
            this.bestGenomeValues = new Float32Array(restoredChampion.genes.flatMap((gene) => [gene.amplitude, gene.frequency, gene.phase]))
            this.bestFitness = this.policy.getChampionFitness()
        }
        this.state = new Float32Array(config.populationSize * topology.particles.length * 4)
        this.metrics = new Float32Array(config.populationSize * 15)
        const particleDefinitions = this.createParticleDefinitions()
        const constraints = this.createConstraints()
        const oscillators = new Float32Array(Math.max(1, config.populationSize * topology.muscles.length * 4))
        const replayFrameCount = replayMode ? Math.max(2, Math.round(config.generationDuration * TRAINING_FRAME_RATE) + 1) : 1
        this.replayPositions = new Float32Array(Math.max(1, replayFrameCount * topology.particles.length * 2 + (replayMode ? 1 : 0)))
        if (replayMode) this.replayPositions[this.replayPositions.length - 1] = -1
        const params = new Float32Array(16)
        try {
            this.stateBuffer = this.createBuffer(this.state, GPU_STORAGE | GPU_COPY_SRC)
            const particleBuffer = this.createBuffer(particleDefinitions, GPU_STORAGE)
            const constraintBuffer = this.createBuffer(constraints, GPU_STORAGE)
            this.genomeBuffer = this.createBuffer(this.genomes, GPU_STORAGE | GPU_COPY_DST)
            this.metricsBuffer = this.createBuffer(this.metrics, GPU_STORAGE | GPU_COPY_SRC)
            this.paramsBuffer = this.createBuffer(params, GPU_STORAGE | GPU_COPY_DST)
            const oscillatorBuffer = this.createBuffer(oscillators, GPU_STORAGE)
            this.replayPositionsBuffer = this.createBuffer(this.replayPositions, GPU_STORAGE | GPU_COPY_SRC)
            this.stateReadBuffer = this.createEmptyBuffer(this.state.byteLength, GPU_MAP_READ | GPU_COPY_DST)
            this.metricsReadBuffer = this.createEmptyBuffer(this.metrics.byteLength, GPU_MAP_READ | GPU_COPY_DST)
            this.replayPositionsReadBuffer = this.createEmptyBuffer(this.replayPositions.byteLength, GPU_MAP_READ | GPU_COPY_DST)
            this.bindGroup = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [this.stateBuffer, particleBuffer, constraintBuffer, this.genomeBuffer, this.metricsBuffer, this.paramsBuffer, oscillatorBuffer, this.replayPositionsBuffer]
                    .map((buffer, binding) => ({ binding, resource: { buffer } })),
            })
        } catch (error) {
            for (const buffer of this.buffers) buffer.destroy()
            this.buffers.length = 0
            throw error
        }
        this.timings = { initializeMs: performance.now() - startedAt, simulationMs: 0, fitnessMs: 0, evolutionMs: 0, resetMs: 0, transferMs: 0, totalGenerationMs: 0 }
        void device.lost.then(() => { this.deviceLost = true })
    }

    updateConfig(config: TrainingEngineConfig): void {
        const targetChanged = config.targetDistance !== this.config.targetDistance
        this.config = config
        this.policy.updateConfig(config)
        if (targetChanged) this.bestFitness = this.policy.getChampionFitness()
    }
    getGeneration(): number { return this.generation }
    getProgress(): number { return this.currentStep / Math.max(1, Math.round(this.config.generationDuration * 60)) * 100 }

    async runChunk(maxSteps: number): Promise<boolean> {
        if (this.deviceLost) throw new Error("WebGPU device was lost")
        if (this.currentStep === 0) this.timings.simulationMs = 0
        const totalSteps = Math.max(1, Math.round(this.config.generationDuration * 60))
        const stepCount = Math.min(
            this.config.backgroundMode ? maxSteps * 10 : maxSteps,
            totalSteps - this.currentStep,
        )
        const params = new Float32Array([
            this.config.populationSize, this.topology.particles.length,
            this.topology.constraints.length + this.topology.muscles.length,
            this.topology.muscles.length, stepCount, this.currentStep, totalSteps,
            600, 100, 570, this.config.targetDistance, this.headIndex(),
            this.replayMode ? 1 : 0,
            this.locomotion.initialStandingHeight,
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
        const shouldReadback = completed || !this.config.backgroundMode
        if (shouldReadback) {
            encoder.copyBufferToBuffer(this.stateBuffer, 0, this.stateReadBuffer, 0, this.state.byteLength)
            encoder.copyBufferToBuffer(this.metricsBuffer, 0, this.metricsReadBuffer, 0, this.metrics.byteLength)
            if (this.replayMode) {
                encoder.copyBufferToBuffer(this.replayPositionsBuffer, 0, this.replayPositionsReadBuffer, 0, this.replayPositions.byteLength)
            }
        }
        this.device.queue.submit([encoder.finish()])
        if (shouldReadback) await this.readGenerationBuffers()
        else await this.device.queue.onSubmittedWorkDone()
        this.currentStep += stepCount
        this.timings.simulationMs += performance.now() - startedAt
        return completed
    }

    finishGeneration(): EvaluatedGeneration {
        const startedAt = performance.now()
        const evaluatedGeneration = this.generation
        const stride = this.muscleIds.length * 3
        const population = Array.from({ length: this.config.populationSize }, (_, creature) =>
            this.materializeGenome(
                this.genomes.slice(creature * stride, (creature + 1) * stride),
                `genome-${evaluatedGeneration}-${creature}`,
                evaluatedGeneration,
            ),
        )
        const values = new Float32Array(this.config.populationSize * CANDIDATE_METRIC_STRIDE)
        const totalSteps = Math.max(1, Math.round(this.config.generationDuration * 60))
        for (let creature = 0; creature < this.config.populationSize; creature++) {
            const source = creature * 15
            const target = creature * CANDIDATE_METRIC_STRIDE
            values[target + CandidateMetricOffset.finalCenterX] = this.metrics[source]
            values[target + CandidateMetricOffset.maxCenterX] = this.metrics[source + 2]
            values[target + CandidateMetricOffset.aliveFrames] = this.metrics[source + 7]
            values[target + CandidateMetricOffset.totalFrames] = totalSteps
            values[target + CandidateMetricOffset.headHeightSum] = this.metrics[source + 8]
            values[target + CandidateMetricOffset.initialStandingHeight] = this.locomotion.initialStandingHeight
            values[target + CandidateMetricOffset.airborneFrames] = this.metrics[source + 9]
            values[target + CandidateMetricOffset.alternatingTransitions] = this.metrics[source + 10]
            values[target + CandidateMetricOffset.reachedTarget] = this.metrics[source + 5]
            values[target + CandidateMetricOffset.firstContactStep] = this.metrics[source + 14]
        }
        const result = this.policy.evaluateAndEvolve(population, { populationSize: population.length, values }, evaluatedGeneration)
        const { bestIndex, targetIndex } = result
        this.bestFitness = Math.max(this.bestFitness, result.bestFitness)
        this.bestGenomeValues = new Float32Array(result.championGenome.genes.flatMap((gene) => [gene.amplitude, gene.frequency, gene.phase]))
        this.timings.fitnessMs = performance.now() - startedAt
        const evolutionStarted = performance.now()
        this.installPopulation(result.genomes)
        this.timings.evolutionMs = performance.now() - evolutionStarted
        this.timings.resetMs = 0
        this.timings.totalGenerationMs = performance.now() - this.generationStartedAt
        this.generationDurations.push(this.timings.totalGenerationMs)
        if (this.generationDurations.length > 30) this.generationDurations.shift()
        this.generation++
        this.currentStep = 0
        this.generationStartedAt = performance.now()
        this.lastEvaluation = {
            generation: evaluatedGeneration,
            bestFitness: result.bestFitness,
            averageFitness: result.averageFitness,
            bestIndex,
            targetIndex,
            bestGenome: population[bestIndex],
            targetGenome: targetIndex >= 0 ? population[targetIndex] : null,
            bestDistance: result.bestDistance,
            medianDistance: result.medianDistance,
            p90Distance: result.p90Distance,
            bestGaitQuality: result.bestGaitQuality,
            archiveCoverage: result.archiveCoverage,
            genomeDiversity: result.genomeDiversity,
            stagnationGenerations: result.stagnationGenerations,
            bestProgress: result.bestDistance / Math.max(1, this.config.targetDistance - 100),
            bestSurvival: result.scores[bestIndex].survival,
            bestSupportTransitions: result.scores[bestIndex].alternatingTransitions,
        }
        return this.lastEvaluation
    }

    getSnapshot(phase: TrainingSnapshot["phase"], includeRender: boolean): TrainingSnapshot {
        const policyDiagnostics = this.policy.getDiagnostics()
        const averageDuration = this.generationDurations.length ? this.generationDurations.reduce((sum, value) => sum + value, 0) / this.generationDurations.length : 0
        return {
            phase, generation: this.generation, progress: Math.round(this.getProgress()),
            bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : 0,
            averageFitness: this.lastEvaluation?.averageFitness ?? 0,
            diagnostics: {
                backend: "webgpu", workerCount: 1,
                generationsPerSecond: averageDuration ? 1000 / averageDuration : 0,
                stageTimings: { ...this.timings }, droppedSnapshots: 0,
                memoryBytes: this.gpuBufferBytes + this.state.byteLength + this.metrics.byteLength
                    + this.genomes.byteLength + this.replayPositions.byteLength,
                policyVersion: 3,
                bestDistance: this.lastEvaluation?.bestDistance ?? policyDiagnostics.bestDistance,
                medianDistance: this.lastEvaluation?.medianDistance,
                p90Distance: this.lastEvaluation?.p90Distance,
                bestGaitQuality: this.lastEvaluation?.bestGaitQuality,
                archiveCoverage: this.lastEvaluation?.archiveCoverage ?? policyDiagnostics.archiveCoverage,
                genomeDiversity: this.lastEvaluation?.genomeDiversity,
                stagnationGenerations: this.lastEvaluation?.stagnationGenerations ?? policyDiagnostics.stagnationGenerations,
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
            policyState: this.policy.exportState(),
        }
    }

    async createReplay(genome: Genome): Promise<PackedTrainingReplay> {
        const replayConfig: TrainingEngineConfig = {
            ...this.config,
            backend: "webgpu",
            populationSize: 1,
            workerCount: 1,
            backgroundMode: false,
        }
        const replayEngine = await WebGpuTrainingEngine.create(
            this.topology,
            replayConfig,
            [genome],
            genome.generation,
            true,
        )
        try {
            await replayEngine.runChunk(Math.max(1, Math.round(replayConfig.generationDuration * TRAINING_FRAME_RATE)))
            const reachedFrame = Math.round(replayEngine.replayPositions[replayEngine.replayPositions.length - 1])
            if (reachedFrame < 0) throw new Error("webgpu could not reproduce the target contact for the winning genome")
            const frameCount = reachedFrame + 1
            const positions = replayEngine.replayPositions.slice(0, frameCount * this.topology.particles.length * 2)
            const centers = new Float32Array(frameCount * 2)
            let totalMass = 0
            for (const particle of this.topology.particles) totalMass += particle.mass
            for (let frame = 0; frame < frameCount; frame++) {
                let weightedX = 0
                let weightedY = 0
                for (let particle = 0; particle < this.topology.particles.length; particle++) {
                    const source = (frame * this.topology.particles.length + particle) * 2
                    weightedX += positions[source] * this.topology.particles[particle].mass
                    weightedY += positions[source + 1] * this.topology.particles[particle].mass
                }
                centers[frame * 2] = totalMass ? weightedX / totalMass : 0
                centers[frame * 2 + 1] = totalMass ? weightedY / totalMass : 0
            }
            return {
                backend: "webgpu",
                generation: genome.generation,
                frameRate: TRAINING_FRAME_RATE,
                frameCount,
                particleCount: this.topology.particles.length,
                reachedFrame,
                positions,
                centers,
                groundY: TRAINING_GROUND_Y,
                targetZone: getTrainingTargetZone(replayConfig.targetDistance),
            }
        } finally {
            replayEngine.dispose()
        }
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        for (const buffer of this.buffers) buffer.destroy()
        this.buffers.length = 0
        this.device.destroy()
        this.gpuBufferBytes = 0
        this.policy.dispose()
        this.genomes = new Float32Array()
        this.state = new Float32Array()
        this.metrics = new Float32Array()
        this.replayPositions = new Float32Array()
        this.bestGenomeValues = null
        this.lastEvaluation = null
        this.generationDurations.length = 0
    }

    private createBuffer(data: Float32Array, usage: number): GpuBufferHandle {
        const size = Math.max(4, data.byteLength)
        const buffer = this.createEmptyBuffer(size, usage | GPU_COPY_DST)
        if (data.byteLength) this.device.queue.writeBuffer(buffer, 0, data)
        return buffer
    }

    private createEmptyBuffer(size: number, usage: number): GpuBufferHandle {
        const allocatedSize = Math.max(4, size)
        const buffer = this.device.createBuffer({ size: allocatedSize, usage })
        this.buffers.push(buffer)
        this.gpuBufferBytes += allocatedSize
        return buffer
    }

    private async readGenerationBuffers(): Promise<void> {
        const startedAt = performance.now()
        await Promise.all([
            this.stateReadBuffer.mapAsync(GPU_MAP_READ),
            this.metricsReadBuffer.mapAsync(GPU_MAP_READ),
            ...(this.replayMode ? [
                this.replayPositionsReadBuffer.mapAsync(GPU_MAP_READ),
            ] : []),
        ])
        this.state.set(new Float32Array(this.stateReadBuffer.getMappedRange()).subarray(0, this.state.length))
        this.metrics.set(new Float32Array(this.metricsReadBuffer.getMappedRange()).subarray(0, this.metrics.length))
        if (this.replayMode) {
            this.replayPositions.set(new Float32Array(this.replayPositionsReadBuffer.getMappedRange()).subarray(0, this.replayPositions.length))
            this.replayPositionsReadBuffer.unmap()
        }
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
        const values = new Float32Array(this.topology.particles.length * 7)
        const supportByParticle = new Int16Array(this.topology.particles.length)
        // The contact mask is represented exactly by f32 up to 24 bits in WGSL.
        this.locomotion.supportGroups.slice(0, 24).forEach((group, groupIndex) => group.forEach((particle) => { supportByParticle[particle] = groupIndex + 1 }))
        this.topology.particles.forEach((particle, index) => values.set([particle.initialPos.x, particle.initialPos.y, particle.mass, particle.radius, particle.isLocked ? 1 : 0, particle.isHead || particle.id === "head" ? 1 : 0, supportByParticle[index]], index * 7))
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

    private installPopulation(population: Genome[]): void {
        let cursor = 0
        for (const genome of population) {
            for (const muscleId of this.muscleIds) {
                const gene = genome.genes.find((candidate) => candidate.muscleId === muscleId)
                this.genomes[cursor++] = gene?.amplitude ?? 0.1
                this.genomes[cursor++] = gene?.frequency ?? 1
                this.genomes[cursor++] = gene?.phase ?? 0
            }
        }
    }

    private materializeGenome(values: Float32Array, id: string, generation: number): Genome {
        const genes: MuscleGene[] = this.muscleIds.map((muscleId, muscle) => ({ muscleId, amplitude: values[muscle * 3], frequency: values[muscle * 3 + 1], phase: values[muscle * 3 + 2] }))
        return { id, genes, generation, createdAt: Date.now() }
    }

    private createRenderSnapshot(maximum: number): TrainingSnapshot["render"] {
        const ranked = selectTopIndices(this.config.populationSize, maximum, (index) => this.metrics[index * 15])
        const creatureCount = ranked.length
        const particleCount = this.topology.particles.length
        const positions = new Float32Array(creatureCount * particleCount * 2)
        const centers = new Float32Array(creatureCount * 2)
        for (let output = 0; output < creatureCount; output++) { const creature = ranked[output]; centers[output * 2] = this.metrics[creature * 15]; centers[output * 2 + 1] = this.metrics[creature * 15 + 1]; for (let particle = 0; particle < particleCount; particle++) { const source = (creature * particleCount + particle) * 4; const target = (output * particleCount + particle) * 2; positions[target] = this.state[source]; positions[target + 1] = this.state[source + 1] } }
        return { creatureCount, particleCount, positions, centers }
    }
}
