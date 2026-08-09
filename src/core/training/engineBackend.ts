import type { Genome, LocomotionCurriculumStage, LocomotionMetrics, PackedTrainingReplay, TrainingEngineConfig, TrainingEngineState, TrainingSnapshot } from "@/core/types"

export interface EvaluatedGeneration {
    generation: number
    bestFitness: number
    averageFitness: number
    bestIndex: number
    targetIndex: number
    bestGenome: Genome
    targetGenome: Genome | null
    bestMetrics: LocomotionMetrics
    targetMetrics: LocomotionMetrics | null
    archiveCoverage: number
    curriculumStage: LocomotionCurriculumStage
}

/** Common contract shared by worker-local CPU, WASM, and GPU engines. */
export interface TrainingBackendEngine {
    updateConfig(config: TrainingEngineConfig): void
    getGeneration(): number
    getProgress(): number
    runChunk(maxSteps: number, budgetMs: number): boolean | Promise<boolean>
    finishGeneration(): EvaluatedGeneration
    getSnapshot(phase: TrainingSnapshot["phase"], includeRender: boolean): TrainingSnapshot
    getBestGenome(): Genome | null
    exportState(): TrainingEngineState | Promise<TrainingEngineState>
    createReplay(genome: Genome): Promise<PackedTrainingReplay>
}
