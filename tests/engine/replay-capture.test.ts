import { describe, expect, it, vi } from "vitest"
import { captureReplayFrames } from "@/core/training/replayCapture"
import type { TrainingBackendEngine } from "@/core/training/engineBackend"
import type { PackedRenderSnapshot, TrainingSnapshot } from "@/core/types"
import { createGenome, createTestTopology, createTrainingConfig } from "../fixtures/training"

function snapshot(render?: PackedRenderSnapshot): TrainingSnapshot {
  return {
    phase: "paused",
    generation: 1,
    progress: 0,
    bestFitness: 0,
    averageFitness: 0,
    diagnostics: {
      backend: "legacy",
      workerCount: 1,
      generationsPerSecond: 0,
      stageTimings: {
        initializeMs: 0,
        simulationMs: 0,
        fitnessMs: 0,
        evolutionMs: 0,
        resetMs: 0,
        transferMs: 0,
        totalGenerationMs: 0,
      },
      memoryBytes: 0,
      droppedSnapshots: 0,
    },
    render,
  }
}

function fakeEngine(frames: Array<PackedRenderSnapshot | undefined>): TrainingBackendEngine {
  let frame = 0
  return {
    updateConfig: vi.fn(),
    getGeneration: () => 1,
    getProgress: () => 0,
    runChunk: vi.fn(async () => { frame += 1; return false }),
    finishGeneration: vi.fn(),
    getSnapshot: vi.fn(() => snapshot(frames[Math.min(frame, frames.length - 1)])),
    getBestGenome: () => null,
    exportState: vi.fn(),
    createReplay: vi.fn(),
  } as unknown as TrainingBackendEngine
}

function render(positions: number[], particleCount = 2): PackedRenderSnapshot {
  return {
    creatureCount: 1,
    particleCount,
    positions: new Float32Array(positions),
    centers: new Float32Array([positions[0], positions[1]]),
  }
}

describe("captureReplayFrames", () => {
  it("records frame zero and stops exactly at the first later contact", async () => {
    const engine = fakeEngine([
      render([100, 550, 120, 570]),
      render([160, 550, 180, 570]),
      render([200, 520, 220, 570]),
      render([400, 520, 420, 570]),
    ])
    const replay = await captureReplayFrames(
      engine,
      createTestTopology(),
      createTrainingConfig({ targetDistance: 200, generationDuration: 1 }),
      createGenome({ generation: 9 }),
      "legacy",
    )
    expect(replay).toMatchObject({ generation: 9, reachedFrame: 2, frameCount: 3, particleCount: 2 })
    expect(replay.positions).toHaveLength(12)
    expect(replay.positions.slice(-4)).toEqual(new Float32Array([200, 520, 220, 570]))
    expect(engine.runChunk).toHaveBeenCalledTimes(2)
  })

  it("uses zero centers for massless topology and accepts initial contact", async () => {
    const topology = createTestTopology()
    topology.particles.forEach(particle => { particle.mass = 0 })
    const engine = fakeEngine([render([100, 550, 120, 570])])
    const replay = await captureReplayFrames(
      engine,
      topology,
      createTrainingConfig({ targetDistance: 100 }),
      createGenome(),
      "wasm-scalar",
    )
    expect(replay.reachedFrame).toBe(0)
    expect(replay.centers).toEqual(new Float32Array([0, 0]))
    expect(engine.runChunk).not.toHaveBeenCalled()
  })

  it.each([
    [undefined, "complete creature frame"],
    [{ ...render([100, 550, 120, 570]), creatureCount: 0 }, "complete creature frame"],
    [render([100, 550], 1), "complete creature frame"],
  ] as const)("rejects an incomplete backend render", async (badRender, message) => {
    const engine = fakeEngine([render([100, 550, 120, 570]), badRender])
    await expect(captureReplayFrames(
      engine,
      createTestTopology(),
      createTrainingConfig({ targetDistance: 200, generationDuration: 0 }),
      createGenome(),
      "legacy",
    )).rejects.toThrow(message)
  })

  it("rejects a winner that cannot reproduce contact before the duration limit", async () => {
    const engine = fakeEngine([render([100, 550, 120, 570])])
    await expect(captureReplayFrames(
      engine,
      createTestTopology(),
      createTrainingConfig({ targetDistance: 5000, generationDuration: 0 }),
      createGenome(),
      "wasm-simd",
    )).rejects.toThrow(/could not reproduce the target contact/)
    expect(engine.runChunk).toHaveBeenCalledTimes(1)
  })
})
