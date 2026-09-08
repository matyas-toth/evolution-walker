import { describe, expect, it } from "vitest"
import { prepareTrainingEvent } from "@/core/training/trainingEventTransfer"
import type { TrainingEvent, TrainingSnapshot } from "@/core/types"
import { createTrainingConfig } from "../fixtures/training"

function snapshot(): TrainingSnapshot {
  return {
    phase: "paused",
    generation: 2,
    progress: 50,
    bestFitness: 1,
    averageFitness: 0.5,
    diagnostics: {
      backend: "wasm-simd",
      workerCount: 2,
      generationsPerSecond: 1,
      stageTimings: { initializeMs: 0, simulationMs: 0, fitnessMs: 0, evolutionMs: 0, resetMs: 0, transferMs: 0, totalGenerationMs: 0 },
      droppedSnapshots: 0,
      memoryBytes: createTrainingConfig().populationSize,
    },
    render: {
      creatureCount: 1,
      particleCount: 2,
      positions: new Float32Array([1, 2, 3, 4]),
      centers: new Float32Array([2, 3]),
    },
  }
}

describe("training event transfers", () => {
  it("can transfer one cached render repeatedly without detaching the engine snapshot", () => {
    const cached = snapshot()
    const event: TrainingEvent = { type: "paused", snapshot: cached }

    for (let attempt = 0; attempt < 3; attempt++) {
      const prepared = prepareTrainingEvent(event)
      const received = structuredClone(prepared.event, { transfer: prepared.transfer })
      expect(received).toMatchObject({ type: "paused", snapshot: { render: { creatureCount: 1 } } })
      expect(cached.render?.positions.byteLength).toBe(16)
      expect(cached.render?.centers.byteLength).toBe(8)
      expect(prepared.transfer[0]).not.toBe(cached.render?.positions.buffer)
    }
  })
})
