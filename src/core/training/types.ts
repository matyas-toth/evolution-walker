import type { Genome, Topology, TrainingHubConfig } from "@/core/types"

export type TrainingBackend = "auto" | "webgpu" | "wasm-simd" | "wasm-scalar" | "legacy"
export type ActiveTrainingBackend = Exclude<TrainingBackend, "auto">
export type TrainingWorkerCount = "auto" | number
export type TrainingEnginePhase = "idle" | "running" | "evaluating" | "evolving" | "paused"
export type LocomotionCurriculumStage = "discovery" | "coordination" | "refinement"

export interface LocomotionMetrics {
    progress: number
    sustainedProgress: number
    locomotionQuality: number
    contactUtilization: number
    periodicity: number
    coordination: number
    traction: number
    carriage: number
    smoothness: number
    energyEfficiency: number
    transportCost: number
    airborneRatio: number
    survivalRatio: number
    descriptor: [number, number, number]
}

export interface QdArchiveElite {
    cell: number
    descriptor: [number, number, number]
    metrics: LocomotionMetrics
    genome: Genome
}

export interface QdArchiveExport {
    dimensions: [number, number, number]
    elites: QdArchiveElite[]
}

export interface TrainingStageTimings {
    initializeMs: number
    simulationMs: number
    fitnessMs: number
    evolutionMs: number
    resetMs: number
    transferMs: number
    totalGenerationMs: number
}

export interface TrainingDiagnostics {
    backend: ActiveTrainingBackend | "initializing"
    workerCount: number
    generationsPerSecond: number
    stageTimings: TrainingStageTimings
    droppedSnapshots: number
    memoryBytes: number
}

export interface PackedRenderSnapshot {
    creatureCount: number
    particleCount: number
    positions: Float32Array
    centers: Float32Array
}

export interface PackedTrainingReplay {
    backend: ActiveTrainingBackend
    generation: number
    frameRate: number
    frameCount: number
    particleCount: number
    reachedFrame: number
    positions: Float32Array
    centers: Float32Array
    groundY: number
    targetZone: { x: number; y: number; width: number; height: number }
}

export interface TrainingSnapshot {
    phase: TrainingEnginePhase
    generation: number
    progress: number
    bestFitness: number
    averageFitness: number
    diagnostics: TrainingDiagnostics
    bestMetrics: LocomotionMetrics
    archiveCoverage: number
    curriculumStage: LocomotionCurriculumStage
    render?: PackedRenderSnapshot
}

export interface TrainingEngineState {
    population: Genome[]
    bestGenome: Genome | null
    bestFitness: number
    generation: number
    archive: QdArchiveExport
    bestMetrics: LocomotionMetrics
}

export interface TrainingEngineConfig extends TrainingHubConfig {
    backend: TrainingBackend
    seed: number
    workerCount: TrainingWorkerCount
    snapshotHz: number
}

export type TrainingCommand =
    | {
        type: "init"
        topology: Topology
        config: TrainingEngineConfig
        initialPopulation?: Genome[]
        initialGeneration?: number
        initialArchive?: QdArchiveExport
        initialBestMetrics?: LocomotionMetrics
    }
    | { type: "start" }
    | { type: "pause" }
    | { type: "reset" }
    | { type: "updateConfig"; config: TrainingEngineConfig }
    | { type: "exportSession"; requestId: number }
    | { type: "requestReplay"; requestId: number; genome: Genome }
    | { type: "dispose" }

export type TrainingEvent =
    | { type: "ready"; snapshot: TrainingSnapshot }
    | { type: "snapshot"; snapshot: TrainingSnapshot }
    | { type: "generation"; generation: number; bestFitness: number; averageFitness: number; bestGenome: Genome; bestMetrics: LocomotionMetrics; archiveCoverage: number; curriculumStage: LocomotionCurriculumStage }
    | { type: "targetReached"; genome: Genome; generation: number; snapshot: TrainingSnapshot; metrics: LocomotionMetrics }
    | { type: "replayReady"; requestId: number; replay: PackedTrainingReplay }
    | { type: "replayFailed"; requestId: number; message: string }
    | { type: "sessionExported"; requestId: number; state: TrainingEngineState }
    | { type: "backendChanged"; backend: ActiveTrainingBackend; workerCount: number }
    | { type: "paused"; snapshot: TrainingSnapshot }
    | { type: "error"; message: string; recoverable: boolean }

export function resolveTrainingEngineConfig(config: TrainingHubConfig): TrainingEngineConfig {
    return {
        populationSize: config.populationSize,
        generationDuration: config.generationDuration,
        mutationRate: config.mutationRate,
        mutationStrength: config.mutationStrength,
        elitismCount: config.elitismCount,
        parentsTopPercent: config.parentsTopPercent,
        targetDistance: config.targetDistance,
        backgroundMode: config.backgroundMode,
        simulationSpeed: Math.max(0.1, Math.min(100, config.simulationSpeed)),
        backend: config.backend ?? "auto",
        seed: config.seed ?? 0x6d2b79f5,
        workerCount: config.workerCount ?? "auto",
        snapshotHz: Math.max(1, Math.min(30, config.snapshotHz ?? 5)),
        fitnessVersion: config.fitnessVersion ?? "adaptive-locomotion-v2",
        controllerVersion: 2,
        upgradedFromSessionId: config.upgradedFromSessionId,
    }
}
