import { describe, expect, it } from "vitest"
import { PackedCpuTrainingEngine } from "@/core/training/packedCpuEngine"
import { createSeededInitialPopulation } from "@/core/genetics/population"
import { STICKMAN_TOPOLOGY } from "@/core/topology"
import { createTrainingConfig } from "../fixtures/training"

const enabled = process.env.RUN_QUALITY_BENCHMARK === "1"
const seeds = [0x6d2b79f5, 0x12345678, 0x9e3779b9, 0xdecafbad, 0x51f15e5d]

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY
}

describe.skipIf(!enabled)("fixed locomotion quality gate", () => {
  it("reaches the policy-v2 progress and gait targets within 400 generations", { timeout: 3_600_000 }, async () => {
    const outcomes = []
    for (const seed of seeds) {
      const config = createTrainingConfig({
        backend: "legacy", seed, populationSize: 500, generationDuration: 10,
        targetDistance: 1400, mutationRate: 0.15, mutationStrength: 0.28,
      })
      const initial = createSeededInitialPopulation(STICKMAN_TOPOLOGY, config.populationSize, seed, 1)
      const engine = new PackedCpuTrainingEngine(STICKMAN_TOPOLOGY, config, initial, 1)
      let walkingBy200 = false
      let progressAt400 = 0
      let reachedHalf = false
      let lastMeaningfulGeneration = 0
      let lastDistance = Number.NEGATIVE_INFINITY
      const improvementGaps: number[] = []
      for (let generation = 1; generation <= 400; generation++) {
        while (!await engine.runChunk(10_000, 10_000)) { /* deterministic packed benchmark */ }
        const evaluated = engine.finishGeneration()
        const distance = evaluated.bestDistance ?? 0
        const threshold = (config.targetDistance - 100) * 0.0025
        if (distance >= lastDistance + threshold) {
          if (lastMeaningfulGeneration) improvementGaps.push(generation - lastMeaningfulGeneration)
          lastMeaningfulGeneration = generation
          lastDistance = distance
        }
        if (generation <= 200 && evaluated.hasWalkingCandidate) walkingBy200 = true
        progressAt400 = Math.max(progressAt400, evaluated.bestProgress ?? 0)
        reachedHalf ||= progressAt400 >= 0.5
      }
      outcomes.push({ seed, walkingBy200, progressAt400, reachedHalf, medianGap: median(improvementGaps) })
    }
    console.table(outcomes)
    expect(outcomes.filter((result) => result.walkingBy200).length).toBeGreaterThanOrEqual(4)
    expect(median(outcomes.map((result) => result.progressAt400))).toBeGreaterThanOrEqual(0.35)
    expect(outcomes.filter((result) => result.reachedHalf).length).toBeGreaterThanOrEqual(2)
    expect(median(outcomes.flatMap((result) => Number.isFinite(result.medianGap) ? [result.medianGap] : []))).toBeLessThanOrEqual(100)
  })
})
