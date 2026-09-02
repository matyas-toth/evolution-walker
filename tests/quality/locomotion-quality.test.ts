import { describe, expect, it } from "vitest"
import { PackedCpuTrainingEngine } from "@/core/training/packedCpuEngine"
import { createSeededInitialPopulation } from "@/core/genetics/population"
import { STICKMAN_TOPOLOGY } from "@/core/topology"
import type { Topology } from "@/core/types"
import { createAsymmetricTwoLegTopology, createFourSupportTopology, createTestTopology, createTrainingConfig } from "../fixtures/training"

const statistical = process.env.RUN_STATISTICAL_QUALITY_BENCHMARK === "1"
const seeds = [0x6d2b79f5, 0x12345678, 0x9e3779b9, 0xdecafbad, 0x51f15e5d]
const statisticalSeeds = Array.from({ length: 30 }, (_, index) => (0x6d2b79f5 + index * 0x9e3779b9) >>> 0)

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY
}

describe("fast locomotion quality gate", () => {
  it("runs policy v3 deterministically without losing its champion", async () => {
    const seed = seeds[0]
    const config = createTrainingConfig({ backend: "legacy", seed, populationSize: 24, generationDuration: 0.25, targetDistance: 1_100 })
    const initial = createSeededInitialPopulation(STICKMAN_TOPOLOGY, config.populationSize, seed, 1)
    const engine = new PackedCpuTrainingEngine(STICKMAN_TOPOLOGY, config, initial, 1)
    let best = 0
    for (let generation = 0; generation < 4; generation++) {
      while (!await engine.runChunk(10_000, 10_000)) { /* bounded deterministic benchmark */ }
      const evaluated = engine.finishGeneration()
      expect(evaluated.bestDistance).toBeGreaterThanOrEqual(best)
      best = evaluated.bestDistance ?? best
      expect(evaluated.bestGenome.genes).toHaveLength(STICKMAN_TOPOLOGY.muscles.length)
    }
    expect(engine.exportState().policyState?.version).toBe(3)
  })
})

if (statistical) describe("scheduled locomotion quality gate", () => {
  const cases: Array<{ name: string; topology: Topology; maximumGenerations: number }> = [
    { name: "stock stickman", topology: STICKMAN_TOPOLOGY, maximumGenerations: 400 },
    { name: "asymmetric two-leg", topology: createAsymmetricTwoLegTopology(), maximumGenerations: 2_000 },
    { name: "single support", topology: createTestTopology(), maximumGenerations: 400 },
    { name: "four support", topology: createFourSupportTopology(), maximumGenerations: 400 },
  ]

  it.each(cases)("runs 30 fixed seeds for $name", { timeout: 14_400_000 }, async ({ name, topology, maximumGenerations }) => {
    const outcomes: Array<{ seed: number; progressAt400: number; reached: boolean; survival: number; transitionRate: number }> = []
    for (const seed of statisticalSeeds) {
      const config = createTrainingConfig({
        backend: "legacy", seed, populationSize: 500, generationDuration: 10,
        targetDistance: 1_100, mutationRate: 0.15, mutationStrength: 0.28,
      })
      const initial = createSeededInitialPopulation(topology, config.populationSize, seed, 1)
      const engine = new PackedCpuTrainingEngine(topology, config, initial, 1)
      let progressAt400 = 0
      let lastChampion = 0
      let reached = false
      let survival = 0
      let transitionRate = 0
      for (let generation = 1; generation <= maximumGenerations; generation++) {
        while (!await engine.runChunk(10_000, 10_000)) { /* deterministic packed benchmark */ }
        const evaluated = engine.finishGeneration()
        const distance = evaluated.bestDistance ?? 0
        expect(distance).toBeGreaterThanOrEqual(lastChampion)
        lastChampion = distance
        if (generation <= 400) progressAt400 = Math.max(progressAt400, distance / (config.targetDistance - 100))
        if (evaluated.targetGenome) {
          reached = true
          survival = evaluated.bestSurvival ?? 0
          transitionRate = (evaluated.bestSupportTransitions ?? 0) / config.generationDuration
          break
        }
      }
      outcomes.push({ seed, progressAt400, reached, survival, transitionRate })
    }
    console.table(outcomes)
    expect(outcomes.every((result) => Number.isFinite(result.progressAt400))).toBe(true)
    if (name === "asymmetric two-leg") {
      expect(median(outcomes.map((result) => result.progressAt400))).toBeGreaterThanOrEqual(0.55)
      expect(outcomes.filter((result) => result.reached).length).toBeGreaterThanOrEqual(24)
      expect(outcomes.filter((result) => result.reached).every((result) => result.survival >= 0.7 && result.transitionRate >= 1)).toBe(true)
    }
  })
})
