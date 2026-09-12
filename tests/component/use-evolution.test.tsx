// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TrainingEngineState, TrainingEvent } from "@/core/types"
import { createGenome, createTestTopology, createTrainingConfig } from "../fixtures/training"

const clientHarness = vi.hoisted(() => ({ instances: [] as any[] }))

vi.mock("@/core/training/TrainingEngineClient", () => ({
  TrainingEngineClient: class {
    listener: ((event: TrainingEvent) => void) | null = null
    initialize = vi.fn()
    updateConfig = vi.fn()
    start = vi.fn()
    pause = vi.fn()
    reset = vi.fn()
    dispose = vi.fn()
    exportSession = vi.fn<() => Promise<TrainingEngineState>>()
    requestReplay = vi.fn()
    constructor() { clientHarness.instances.push(this) }
    subscribe(listener: (event: TrainingEvent) => void) {
      this.listener = listener
      return () => { this.listener = null }
    }
    emit(event: TrainingEvent) { this.listener?.(event) }
  },
}))

import { useEvolution } from "@/hooks/useEvolution"

const diagnostics = {
  backend: "legacy" as const,
  workerCount: 1,
  generationsPerSecond: 2,
  droppedSnapshots: 0,
  memoryBytes: 100,
  stageTimings: {
    initializeMs: 1,
    simulationMs: 2,
    fitnessMs: 3,
    evolutionMs: 4,
    resetMs: 5,
    transferMs: 6,
    totalGenerationMs: 20,
  },
}

beforeEach(() => { clientHarness.instances.length = 0 })

describe("useEvolution", () => {
  it("owns one client lifecycle and reacts to snapshots and controls", () => {
    const topology = createTestTopology()
    const { result, unmount } = renderHook(() => useEvolution({ ...createTrainingConfig(), topology }))
    const client = clientHarness.instances.at(-1)
    expect(client.initialize).toHaveBeenCalledWith(topology, expect.objectContaining({ seed: 12345 }), undefined, undefined)

    act(() => client.emit({
      type: "ready",
      snapshot: { phase: "idle", generation: 1, progress: 0, bestFitness: 0, averageFitness: 0, diagnostics },
    }))
    act(() => result.current.start())
    expect(result.current.phase).toBe("idle")
    act(() => client.emit({
      type: "snapshot",
      snapshot: { phase: "running", generation: 1, progress: 0, bestFitness: 0, averageFitness: 0, diagnostics },
    }))
    expect(result.current.phase).toBe("running")
    expect(client.start).toHaveBeenCalledOnce()
    act(() => result.current.stop())
    expect(result.current.phase).toBe("running")
    expect(result.current.pausePending).toBe(true)
    expect(client.pause).toHaveBeenCalledOnce()
    act(() => client.emit({
      type: "paused",
      snapshot: { phase: "paused", generation: 1, progress: 25, bestFitness: 0, averageFitness: 0, diagnostics },
    }))
    expect(result.current).toMatchObject({ phase: "paused", progress: 25, pausePending: false })
    unmount()
    expect(client.dispose).toHaveBeenCalledOnce()
  })

  it("records generations, best creature, target victory, and reset state", () => {
    const onTargetReached = vi.fn()
    const topology = createTestTopology()
    const config = createTrainingConfig()
    const { result } = renderHook(() => useEvolution({
      ...config,
      topology,
      onTargetReached,
    }))
    const client = clientHarness.instances.at(-1)
    const genome = createGenome({ generation: 7 })
    act(() => client.emit({ type: "generation", generation: 7, bestFitness: 88, averageFitness: 44, bestGenome: genome }))
    expect(result.current.fitnessHistory).toEqual([{ generation: 7, bestFitness: 88, averageFitness: 44 }])
    expect(result.current.bestCreatureEver?.fitness.total).toBe(88)
    act(() => client.emit({
      type: "targetReached",
      genome,
      generation: 7,
      snapshot: { phase: "paused", generation: 7, progress: 100, bestFitness: 88, averageFitness: 44, diagnostics },
    }))
    expect(result.current).toMatchObject({ phase: "paused", generation: 7, progress: 100 })
    expect(onTargetReached).toHaveBeenCalledOnce()
    act(() => result.current.reset())
    expect(result.current).toMatchObject({ phase: "idle", generation: 0, progress: 0, fitnessHistory: [] })
    expect(client.reset).toHaveBeenCalledOnce()
  })

  it("continues from a victory with the existing population and chart history", () => {
    const topology = createTestTopology()
    const { result } = renderHook(() => useEvolution({ ...createTrainingConfig(), topology }))
    const client = clientHarness.instances.at(-1)
    const genome = createGenome({ generation: 7 })

    act(() => client.emit({ type: "generation", generation: 7, bestFitness: 1500, averageFitness: 44, bestGenome: genome }))
    act(() => client.emit({
      type: "targetReached",
      genome,
      generation: 7,
      snapshot: { phase: "paused", generation: 7, progress: 100, bestFitness: 1500, averageFitness: 44, diagnostics },
    }))
    const history = result.current.fitnessHistory
    const champion = result.current.bestCreatureEver

    act(() => result.current.continueTraining(1900))

    expect(client.updateConfig).toHaveBeenLastCalledWith(expect.objectContaining({ targetDistance: 1900 }))
    expect(client.start).toHaveBeenCalledOnce()
    expect(client.reset).not.toHaveBeenCalled()
    expect(result.current.generation).toBe(7)
    expect(result.current.fitnessHistory).toBe(history)
    expect(result.current.bestCreatureEver).toBe(champion)
    act(() => client.emit({
      type: "snapshot",
      snapshot: { phase: "paused", generation: 7, progress: 100, bestFitness: 200, averageFitness: 44, diagnostics },
    }))
    expect(result.current.bestCreatureEver?.genome).toBe(champion?.genome)
    expect(result.current.bestCreatureEver?.fitness.total).toBe(200)
  })

  it("surfaces engine errors and delegates export/replay requests", async () => {
    const topology = createTestTopology()
    const config = createTrainingConfig()
    const { result } = renderHook(() => useEvolution({ ...config, topology }))
    const client = clientHarness.instances.at(-1)
    const state = { population: [createGenome()], bestGenome: createGenome(), bestFitness: 1, generation: 2 }
    client.exportSession.mockResolvedValue(state)
    client.requestReplay.mockResolvedValue({ marker: true })
    act(() => client.emit({ type: "error", message: "device lost", recoverable: true }))
    expect(result.current.error).toBe("device lost")
    await expect(result.current.exportSession()).resolves.toEqual(state)
    await result.current.requestReplay(createGenome())
    expect(client.requestReplay).toHaveBeenCalledOnce()
  })
})
