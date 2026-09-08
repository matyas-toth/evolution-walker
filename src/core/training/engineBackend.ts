import type { Genome, PackedTrainingReplay, TrainingEngineConfig, TrainingEngineState, TrainingSnapshot } from "@/core/types"

export interface EvaluatedGeneration {
    generation: number
    bestFitness: number
    averageFitness: number
    bestIndex: number
    targetIndex: number
    bestGenome: Genome
    targetGenome: Genome | null
    bestDistance?: number
    bestProgress?: number
    bestSurvival?: number
    bestSupportTransitions?: number
    hasWalkingCandidate?: boolean
    medianDistance?: number
    p90Distance?: number
    bestGaitQuality?: number
    archiveCoverage?: number
    genomeDiversity?: number
    stagnationGenerations?: number
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
    dispose(): void | Promise<void>
}

/** Selects a deterministic top-k without allocating or sorting a population-sized index array. */
export function selectTopIndices(count: number, maximum: number, scoreAt: (index: number) => number): number[] {
    const selected: number[] = []
    const selectedScores: number[] = []
    for (let candidate = 0; candidate < count; candidate++) {
        const rawScore = scoreAt(candidate)
        const candidateScore = Number.isFinite(rawScore) ? rawScore : Number.NEGATIVE_INFINITY
        let insertion = 0
        while (insertion < selected.length && selectedScores[insertion] >= candidateScore) insertion++
        if (insertion >= maximum) continue
        selected.splice(insertion, 0, candidate)
        selectedScores.splice(insertion, 0, candidateScore)
        if (selected.length > maximum) selected.pop()
        if (selectedScores.length > maximum) selectedScores.pop()
    }
    return selected
}
