/// <reference lib="webworker" />

import { PackedCpuTrainingEngine } from "./packedCpuEngine"
import { RustWasmTrainingEngine } from "./RustWasmTrainingEngine"
import { WebGpuTrainingEngine } from "./WebGpuTrainingEngine"
import { MulticoreWasmTrainingEngine } from "./MulticoreWasmTrainingEngine"
import type { TrainingBackendEngine } from "./engineBackend"
import type {
    ActiveTrainingBackend,
    Genome,
    Topology,
    TrainingCommand,
    TrainingEngineConfig,
    TrainingEvent,
    TrainingSnapshot,
} from "@/core/types"

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope
const PHYSICS_CHUNK_STEPS = 24
const PHYSICS_CHUNK_BUDGET_MS = 35
const VISIBLE_SNAPSHOT_HZ = 30

let engine: TrainingBackendEngine | null = null
let topology: Topology | null = null
let config: TrainingEngineConfig | null = null
let initialPopulation: Genome[] | undefined
let initialGeneration = 1
let phase: TrainingSnapshot["phase"] = "idle"
let running = false
let disposed = false
let scheduled = false
let lastSnapshotAt = 0
let lastGenerationEventAt = 0
let droppedSnapshots = 0
let pendingGeneration: ReturnType<TrainingBackendEngine["finishGeneration"]> | null = null
let activeBackend: ActiveTrainingBackend = "wasm-scalar"

/** Posts a typed event and transfers render buffers when present. */
function emit(event: TrainingEvent): void {
    const transfer: Transferable[] = []
    if ((event.type === "snapshot" || event.type === "ready" || event.type === "paused") && event.snapshot.render) {
        transfer.push(event.snapshot.render.positions.buffer, event.snapshot.render.centers.buffer)
    }
    if (event.type === "replayReady") {
        transfer.push(event.replay.positions.buffer, event.replay.centers.buffer)
    }
    workerScope.postMessage(event, transfer)
}

/** Adds coordinator-owned pacing and delivery diagnostics to a backend snapshot. */
function decorateSnapshot(snapshot: TrainingSnapshot): void {
    if (!config) return
    snapshot.diagnostics.backend = activeBackend
    snapshot.diagnostics.droppedSnapshots = droppedSnapshots
    if (!config.backgroundMode && snapshot.phase !== "idle") {
        snapshot.diagnostics.generationsPerSecond = config.simulationSpeed / config.generationDuration
    }
}

/** Resolves the requested accelerated backend before concrete initialization. */
async function resolveBackend(requested: TrainingEngineConfig["backend"]): Promise<ActiveTrainingBackend> {
    if (requested === "webgpu") {
        const navigatorWithGpu = navigator as WorkerNavigator & { gpu?: unknown }
        if (navigatorWithGpu.gpu) return "webgpu"
        emit({ type: "error", message: "WebGPU is unavailable; continuing with WASM SIMD.", recoverable: true })
    }
    if (requested === "legacy") return "legacy"
    if (requested === "wasm-scalar") return "wasm-scalar"
    return "wasm-simd"
}

/** Compares three short seeded generations and selects GPU only for a material win. */
async function selectAutoBackend(): Promise<ActiveTrainingBackend> {
    if (!topology || !config || !(navigator as WorkerNavigator & { gpu?: unknown }).gpu) return "wasm-simd"
    const warmupConfig: TrainingEngineConfig = {
        ...config,
        backend: "wasm-simd",
        populationSize: Math.min(config.populationSize, 256),
        generationDuration: Math.min(config.generationDuration, 3),
        backgroundMode: true,
    }
    const benchmark = async (candidate: TrainingBackendEngine): Promise<number> => {
        const startedAt = performance.now()
        for (let generation = 0; generation < 3; generation++) {
            while (!await candidate.runChunk(PHYSICS_CHUNK_STEPS, PHYSICS_CHUNK_BUDGET_MS)) {
                // Warmup is worker-local and intentionally avoids UI snapshots.
            }
            candidate.finishGeneration()
        }
        return performance.now() - startedAt
    }
    try {
        const cpu = await RustWasmTrainingEngine.create(topology, warmupConfig, undefined, 1, "wasm-simd")
        const gpu = await WebGpuTrainingEngine.create(topology, { ...warmupConfig, backend: "webgpu" }, undefined, 1)
        const cpuMs = await benchmark(cpu)
        const gpuMs = await benchmark(gpu)
        return cpuMs / gpuMs >= 1.5 ? "webgpu" : "wasm-simd"
    } catch {
        return "wasm-simd"
    }
}

/** Builds a fresh persistent engine from the latest serializable inputs. */
async function initializeEngine(emitReady = true): Promise<void> {
    if (!topology || !config) return
    droppedSnapshots = 0
    pendingGeneration = null
    activeBackend = config.backend === "auto" ? await selectAutoBackend() : await resolveBackend(config.backend)
    try {
        engine = activeBackend === "legacy"
            ? new PackedCpuTrainingEngine(topology, config, initialPopulation, initialGeneration)
            : activeBackend === "webgpu"
            ? await WebGpuTrainingEngine.create(topology, config, initialPopulation, initialGeneration)
            : activeBackend === "wasm-simd"
                ? await MulticoreWasmTrainingEngine.create(topology, config, initialPopulation, initialGeneration, activeBackend)
                : await RustWasmTrainingEngine.create(topology, config, initialPopulation, initialGeneration, activeBackend)
    } catch (acceleratedError) {
        if (activeBackend === "webgpu") {
            try {
                activeBackend = "wasm-simd"
                engine = await MulticoreWasmTrainingEngine.create(topology, config, initialPopulation, initialGeneration, activeBackend)
            } catch {
                engine = null
            }
        }
        if (!engine && activeBackend === "wasm-simd") {
            try {
                activeBackend = "wasm-scalar"
                engine = await RustWasmTrainingEngine.create(
                    topology,
                    config,
                    initialPopulation,
                    initialGeneration,
                    activeBackend,
                )
            } catch {
                engine = null
            }
        }
        if (engine) {
            emit({
                type: "error",
                message: acceleratedError instanceof Error
                    ? `Requested backend unavailable (${acceleratedError.message}); using ${activeBackend}.`
                    : `Requested backend unavailable; using ${activeBackend}.`,
                recoverable: true,
            })
        }
        if (!engine) {
            activeBackend = "wasm-scalar"
            engine = new PackedCpuTrainingEngine(topology, config, initialPopulation, initialGeneration)
            emit({
                type: "error",
                message: acceleratedError instanceof Error
                    ? `Rust/WASM backend unavailable (${acceleratedError.message}); using the packed worker fallback.`
                    : "Rust/WASM backend unavailable; using the packed worker fallback.",
                recoverable: true,
            })
        }
    }
    phase = "idle"
    const snapshot = engine.getSnapshot(phase, false)
    decorateSnapshot(snapshot)
    emit({ type: "backendChanged", backend: activeBackend, workerCount: snapshot.diagnostics.workerCount })
    if (emitReady) emit({ type: "ready", snapshot })
}

/** Replays the current genomes to the previous progress after a backend-only migration. */
async function restoreGenerationProgress(targetProgress: number): Promise<void> {
    if (!engine || !config || targetProgress <= 0) return
    const runtimeConfig = config
    const replayConfig: TrainingEngineConfig = { ...runtimeConfig, backgroundMode: false }
    engine.updateConfig(replayConfig)
    const totalSteps = Math.max(1, Math.round(runtimeConfig.generationDuration * 60))
    while (engine.getProgress() + 0.01 < targetProgress) {
        const remainingSteps = Math.max(
            1,
            Math.ceil((targetProgress - engine.getProgress()) / 100 * totalSteps),
        )
        const completed = await engine.runChunk(
            Math.min(PHYSICS_CHUNK_STEPS, remainingSteps),
            PHYSICS_CHUNK_BUDGET_MS,
        )
        if (completed) break
    }
    engine.updateConfig(runtimeConfig)
}

/** Creates a bounded snapshot at the configured UI frequency. */
function emitSnapshot(force = false): void {
    if (!engine || !config) return
    const now = performance.now()
    const interval = 1000 / (config.backgroundMode ? config.snapshotHz : Math.max(VISIBLE_SNAPSHOT_HZ, config.snapshotHz))
    if (!force && now - lastSnapshotAt < interval) {
        droppedSnapshots++
        return
    }
    lastSnapshotAt = now
    const snapshot = engine.getSnapshot(phase, !config.backgroundMode)
    decorateSnapshot(snapshot)
    emit({ type: "snapshot", snapshot })
}

/** Coalesces generation notifications so React never follows raw engine throughput. */
function emitPendingGeneration(force = false): void {
    if (!pendingGeneration || !config) return
    const now = performance.now()
    const interval = 1000 / (config.backgroundMode ? config.snapshotHz : Math.max(VISIBLE_SNAPSHOT_HZ, config.snapshotHz))
    if (!force && now - lastGenerationEventAt < interval) return
    lastGenerationEventAt = now
    const evaluated = pendingGeneration
    pendingGeneration = null
    emit({
        type: "generation",
        generation: evaluated.generation,
        bestFitness: evaluated.bestFitness,
        averageFitness: evaluated.averageFitness,
        bestGenome: evaluated.bestGenome,
    })
}

/** Runs one bounded worker task so pause/reset messages are serviced promptly. */
async function runChunk(): Promise<void> {
    scheduled = false
    if (!running || disposed || !engine || !config) return
    phase = "running"
    const progressBefore = engine.getProgress()
    const chunkStartedAt = performance.now()
    let completed: boolean
    try {
        const chunkSteps = config.backgroundMode
            ? PHYSICS_CHUNK_STEPS
            : Math.max(1, Math.min(PHYSICS_CHUNK_STEPS, Math.round(config.simulationSpeed * 2)))
        completed = await engine.runChunk(chunkSteps, PHYSICS_CHUNK_BUDGET_MS)
    } catch (backendError) {
        if (!topology || !config) throw backendError
        const checkpoint = await engine.exportState()
        activeBackend = "wasm-scalar"
        engine = await RustWasmTrainingEngine.create(topology, config, checkpoint.population, checkpoint.generation, activeBackend)
        emit({
            type: "error",
            message: backendError instanceof Error
                ? `${backendError.message}; restarted the current generation on WASM scalar.`
                : "Accelerated backend failed; restarted the current generation on WASM scalar.",
            recoverable: true,
        })
        emit({ type: "backendChanged", backend: activeBackend, workerCount: 1 })
        scheduleChunk()
        return
    }
    const chunkComputeMs = performance.now() - chunkStartedAt
    const progressAfter = completed ? 100 : engine.getProgress()
    const simulatedMilliseconds = Math.max(0, progressAfter - progressBefore) / 100
        * config.generationDuration * 1000
    const pacingDelayMs = config.backgroundMode
        ? 0
        : Math.max(0, simulatedMilliseconds / config.simulationSpeed - chunkComputeMs)
    emitSnapshot(false)

    if (completed) {
        phase = "evaluating"
        const evaluated = engine.finishGeneration()
        pendingGeneration = pendingGeneration && pendingGeneration.bestFitness > evaluated.bestFitness
            ? { ...evaluated, bestFitness: pendingGeneration.bestFitness, bestGenome: pendingGeneration.bestGenome }
            : evaluated
        emitPendingGeneration(false)
        if (evaluated.targetGenome) {
            emitPendingGeneration(true)
            running = false
            phase = "paused"
            const victorySnapshot = engine.getSnapshot(phase, false)
            victorySnapshot.generation = evaluated.generation
            victorySnapshot.progress = 100
            decorateSnapshot(victorySnapshot)
            emit({
                type: "targetReached",
                genome: evaluated.targetGenome,
                generation: evaluated.generation,
                snapshot: victorySnapshot,
            })
            return
        }
        phase = "running"
        emitSnapshot(false)
    }

    scheduleChunk(pacingDelayMs)
}

function scheduleChunk(delayMs = 0): void {
    if (scheduled || !running || disposed) return
    scheduled = true
    setTimeout(() => {
        commandQueue = commandQueue.then(() => runChunk())
    }, delayMs)
}

let commandQueue = Promise.resolve()

/** Serializes async lifecycle commands so a warmup cannot overwrite a later config change. */
async function handleCommand(command: TrainingCommand): Promise<void> {
    try {
        switch (command.type) {
            case "init":
                topology = command.topology
                config = command.config
                initialPopulation = command.initialPopulation
                initialGeneration = command.initialGeneration ?? 1
                disposed = false
                running = false
                await initializeEngine()
                break
            case "start":
                if (!engine) throw new Error("Training engine is not initialized")
                running = true
                phase = "running"
                emitSnapshot(true)
                scheduleChunk()
                break
            case "pause":
                running = false
                phase = "paused"
                emitPendingGeneration(true)
                if (engine && config) {
                    const pausedSnapshot = engine.getSnapshot(phase, !config.backgroundMode)
                    decorateSnapshot(pausedSnapshot)
                    emit({ type: "paused", snapshot: pausedSnapshot })
                }
                break
            case "reset":
                running = false
                initialPopulation = undefined
                initialGeneration = 1
                await initializeEngine()
                break
            case "updateConfig": {
                const previousConfig = config
                const backendChanged = Boolean(previousConfig && previousConfig.backend !== command.config.backend)
                const requiresFreshPopulation = !previousConfig
                    || previousConfig.populationSize !== command.config.populationSize
                    || previousConfig.generationDuration !== command.config.generationDuration
                    || previousConfig.seed !== command.config.seed
                    || previousConfig.workerCount !== command.config.workerCount
                config = command.config
                if (backendChanged && !requiresFreshPopulation && engine) {
                    const previousPhase = phase
                    const resumeAfterMigration = running
                    const previousProgress = engine.getProgress()
                    const checkpoint = await engine.exportState()
                    running = false
                    initialPopulation = checkpoint.population
                    initialGeneration = checkpoint.generation
                    await initializeEngine(false)
                    await restoreGenerationProgress(previousProgress)
                    phase = previousPhase
                    const migratedSnapshot = engine.getSnapshot(phase, !config.backgroundMode)
                    decorateSnapshot(migratedSnapshot)
                    emit(phase === "paused"
                        ? { type: "paused", snapshot: migratedSnapshot }
                        : { type: "snapshot", snapshot: migratedSnapshot })
                    running = resumeAfterMigration
                    if (running) scheduleChunk()
                } else if (requiresFreshPopulation) {
                    running = false
                    initialPopulation = undefined
                    initialGeneration = 1
                    await initializeEngine()
                } else {
                    engine?.updateConfig(command.config)
                    if (!running && engine) {
                        const updatedSnapshot = engine.getSnapshot(phase, !command.config.backgroundMode)
                        decorateSnapshot(updatedSnapshot)
                        emit({ type: "snapshot", snapshot: updatedSnapshot })
                    }
                }
                break
            }
            case "exportSession":
                if (!engine) throw new Error("Training engine is not initialized")
                emit({ type: "sessionExported", requestId: command.requestId, state: await engine.exportState() })
                break
            case "requestReplay":
                if (!engine) {
                    emit({ type: "replayFailed", requestId: command.requestId, message: "Training engine is not initialized" })
                    break
                }
                try {
                    const replay = await engine.createReplay(command.genome)
                    emit({ type: "replayReady", requestId: command.requestId, replay })
                } catch (replayError) {
                    emit({
                        type: "replayFailed",
                        requestId: command.requestId,
                        message: replayError instanceof Error ? replayError.message : "Exact replay capture failed",
                    })
                }
                break
            case "dispose":
                running = false
                disposed = true
                engine = null
                workerScope.close()
                break
        }
    } catch (error) {
        emit({
            type: "error",
            message: error instanceof Error ? error.message : "Unknown training worker error",
            recoverable: false,
        })
    }
}

workerScope.onmessage = (event: MessageEvent<TrainingCommand>) => {
    commandQueue = commandQueue.then(() => handleCommand(event.data))
}

export {}
