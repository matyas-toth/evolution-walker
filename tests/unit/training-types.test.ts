import { describe, expect, it } from "vitest"
import { resolveTrainingEngineConfig } from "@/core/training/types"
import { calculateFixedReplayCamera } from "@/core/training/replayCamera"
import {
  getTrainingTargetZone,
  TRAINING_GROUND_Y,
  TRAINING_TARGET_HEIGHT,
  TRAINING_TARGET_WIDTH,
} from "@/core/training/world"
import { createReplay, createTestTopology, createTrainingConfig } from "../fixtures/training"

describe("training configuration and world", () => {
  it("applies backward-compatible defaults and clamps update frequencies", () => {
    const base = createTrainingConfig()
    const resolved = resolveTrainingEngineConfig({
      ...base,
      backend: undefined,
      seed: undefined,
      workerCount: undefined,
      snapshotHz: 999,
      simulationSpeed: 0,
    })
    expect(resolved).toMatchObject({ backend: "auto", workerCount: "auto", snapshotHz: 30, simulationSpeed: 0.1 })
    expect(resolveTrainingEngineConfig({ ...base, snapshotHz: 0 }).snapshotHz).toBe(1)
  })

  it("centralizes exact target geometry", () => {
    expect(getTrainingTargetZone(700)).toEqual({
      x: 700,
      y: 500,
      width: TRAINING_TARGET_WIDTH,
      height: TRAINING_TARGET_HEIGHT,
    })
    expect(TRAINING_GROUND_Y).toBe(600)
  })
})

describe("fixed replay camera", () => {
  it("includes every recorded position and target in one immutable transform", () => {
    const replay = createReplay()
    const camera = calculateFixedReplayCamera(replay, createTestTopology(), { width: 524, height: 258 })!
    expect(camera.bounds.minX).toBeLessThanOrEqual(95)
    expect(camera.bounds.maxX).toBeGreaterThanOrEqual(300)
    expect(camera.scale).toBeGreaterThan(0)
    expect(camera).toEqual(calculateFixedReplayCamera(replay, createTestTopology(), { width: 524, height: 258 }))
  })

  it("scales long routes down, ignores invalid samples, and rejects empty viewports", () => {
    const replay = createReplay({
      targetZone: { x: 7_000, y: 500, width: 100, height: 80 },
      positions: new Float32Array([100, 550, Number.NaN, 500, 7_000, 520, 7_020, 570]),
      frameCount: 2,
    })
    const camera = calculateFixedReplayCamera(replay, createTestTopology(), { width: 524, height: 258 })!
    expect(camera.scale).toBeLessThan(0.1)
    expect(camera.bounds.minX).toBeLessThan(100)
    expect(camera.bounds.maxX).toBeGreaterThan(7_000)
    expect(calculateFixedReplayCamera(replay, createTestTopology(), { width: 0, height: 258 })).toBeNull()
  })
})
