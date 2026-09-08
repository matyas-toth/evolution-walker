import { describe, expect, it } from "vitest"
import { PackedCpuTrainingEngine } from "@/core/training/packedCpuEngine"
import { createGenome, createTestTopology, createTrainingConfig } from "../fixtures/training"

async function finish(engine: PackedCpuTrainingEngine) {
  while (!await engine.runChunk(100, 100)) { /* bounded test workload */ }
  return engine.finishGeneration()
}

describe("PackedCpuTrainingEngine", () => {
  it("initializes persistent slabs and exposes bounded render snapshots", () => {
    const engine = new PackedCpuTrainingEngine(createTestTopology(), createTrainingConfig())
    const snapshot = engine.getSnapshot("paused", true)
    expect(snapshot).toMatchObject({ generation: 1, progress: 0, phase: "paused" })
    expect(snapshot.render?.creatureCount).toBe(5)
    expect(snapshot.render?.particleCount).toBe(2)
    expect(snapshot.render?.positions).toHaveLength(20)
    expect(snapshot.diagnostics.memoryBytes).toBeGreaterThan(0)
  })

  it("advances exact progress, evaluates, evolves, and exports compatible JSON genomes", async () => {
    const config = createTrainingConfig({ populationSize: 4 })
    const engine = new PackedCpuTrainingEngine(createTestTopology(), config)
    expect(await engine.runChunk(1, 100)).toBe(false)
    expect(engine.getProgress()).toBeGreaterThan(0)
    const evaluated = await finish(engine)
    expect(evaluated.generation).toBe(1)
    expect(Number.isFinite(evaluated.bestFitness)).toBe(true)
    expect(engine.getGeneration()).toBe(2)
    const state = engine.exportState()
    expect(state.population).toHaveLength(4)
    expect(state.generation).toBe(2)
    for (const genome of state.population) {
      expect(genome.genes).toHaveLength(1)
      expect(genome.genes[0].amplitude).toBeGreaterThanOrEqual(0.05)
      expect(genome.genes[0].amplitude).toBeLessThanOrEqual(0.8)
    }
  })

  it("is reproducible for equal seeds and imported populations", async () => {
    const topology = createTestTopology()
    const config = createTrainingConfig({ populationSize: 4, seed: 77 })
    const first = new PackedCpuTrainingEngine(topology, config)
    const second = new PackedCpuTrainingEngine(topology, config)
    const [left, right] = await Promise.all([finish(first), finish(second)])
    expect(left.bestFitness).toBe(right.bestFitness)
    expect(left.averageFitness).toBe(right.averageFitness)
    expect(first.exportState().population.map(genome => genome.genes)).toEqual(
      second.exportState().population.map(genome => genome.genes),
    )
  })

  it("detects a target and captures a replay through first contact", async () => {
    const config = createTrainingConfig({ populationSize: 1, targetDistance: 100 })
    const genome = createGenome()
    const engine = new PackedCpuTrainingEngine(createTestTopology(), config, [genome], 8)
    const replay = await engine.createReplay(genome)
    expect(replay.reachedFrame).toBe(0)
    expect(replay.frameCount).toBe(1)
    expect(replay.positions).toHaveLength(replay.particleCount * 2)
    expect(replay.targetZone).toEqual({ x: 100, y: 500, width: 100, height: 80 })
    await engine.runChunk(100, 100)
    expect(engine.finishGeneration().targetIndex).toBe(0)
  })

  it("updates runtime configuration without resetting generation state", async () => {
    const engine = new PackedCpuTrainingEngine(createTestTopology(), createTrainingConfig())
    await engine.runChunk(1, 100)
    const progress = engine.getProgress()
    engine.updateConfig(createTrainingConfig({ simulationSpeed: 100, targetDistance: 700 }))
    expect(engine.getProgress()).toBe(progress)
    expect(engine.getGeneration()).toBe(1)
  })

  it("restores the v3 champion, archive, and stagnation state across backend checkpoints", async () => {
    const topology = createTestTopology()
    const config = createTrainingConfig({ populationSize: 4 })
    const source = new PackedCpuTrainingEngine(topology, config)
    await finish(source)
    const checkpoint = source.exportState()
    const restored = new PackedCpuTrainingEngine(topology, config, checkpoint.population, checkpoint.generation, checkpoint.policyState)
    const snapshot = restored.getSnapshot("paused", false)
    expect(restored.getBestGenome()).not.toBeNull()
    expect(snapshot.diagnostics.policyVersion).toBe(3)
    expect(snapshot.diagnostics.archiveCoverage).toBeGreaterThan(0)
    expect(snapshot.diagnostics.bestDistance).toBe(checkpoint.policyState?.bestSustainedDistance)
  })

  it("completes and evolves the maximum supported population", async () => {
    const config = createTrainingConfig({ populationSize: 2_000, backgroundMode: true })
    const engine = new PackedCpuTrainingEngine(createTestTopology(), config)

    const evaluated = await finish(engine)

    expect(evaluated.generation).toBe(1)
    expect(Number.isFinite(evaluated.bestFitness)).toBe(true)
    expect(engine.exportState().population).toHaveLength(2_000)
    engine.dispose()
  })
})
