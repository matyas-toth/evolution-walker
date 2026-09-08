import { beforeEach, describe, expect, it, vi } from "vitest"
import { createSeededInitialPopulation } from "@/core/genetics/population"
import { MulticoreWasmTrainingEngine } from "@/core/training/MulticoreWasmTrainingEngine"
import { createTestTopology, createTrainingConfig } from "../fixtures/training"
import type { TrainingSnapshot } from "@/core/types"

class FakeShardWorker {
  static instances: FakeShardWorker[] = []
  static failingInitialization = -1
  static hangingInitialization = -1
  static crashingCommand = ""
  static snapshotResponses = false
  readonly index: number
  onmessage: ((event: MessageEvent<Record<string, unknown>>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  postCount = 0

  constructor() {
    this.index = FakeShardWorker.instances.length
    FakeShardWorker.instances.push(this)
  }

  postMessage(command: { id: number; type: string }) {
    this.postCount++
    queueMicrotask(() => {
      if (this.terminated) return
      if (command.type === "init" && this.index === FakeShardWorker.hangingInitialization) return
      if (command.type === FakeShardWorker.crashingCommand) {
        this.onerror?.({ message: "shard crashed" } as ErrorEvent)
        return
      }
      if (command.type === "run" && FakeShardWorker.snapshotResponses) {
        const center = this.index * 100
        const snapshot: TrainingSnapshot = {
          phase: "running",
          generation: 1,
          progress: 10,
          bestFitness: 0,
          averageFitness: 0,
          diagnostics: {
            backend: "wasm-simd",
            workerCount: 1,
            generationsPerSecond: 0,
            stageTimings: { initializeMs: 0, simulationMs: 0, fitnessMs: 0, evolutionMs: 0, resetMs: 0, transferMs: 0, totalGenerationMs: 0 },
            droppedSnapshots: 0,
            memoryBytes: 100,
          },
          render: {
            creatureCount: 2,
            particleCount: 2,
            positions: new Float32Array([center, 0, center, 1, center + 1, 0, center + 1, 1]),
            centers: new Float32Array([center, 0, center + 1, 0]),
          },
        }
        this.onmessage?.({ data: { id: command.id, progress: 10, completed: false, snapshot } } as unknown as MessageEvent<Record<string, unknown>>)
        return
      }
      if (command.type === "init" && this.index === FakeShardWorker.failingInitialization) {
        this.onmessage?.({ data: { id: command.id, error: "initialization failed" } } as unknown as MessageEvent<Record<string, unknown>>)
      } else {
        this.onmessage?.({ data: { id: command.id, ok: true } } as unknown as MessageEvent<Record<string, unknown>>)
      }
    })
  }

  terminate() { this.terminated = true }
}

beforeEach(() => {
  FakeShardWorker.instances = []
  FakeShardWorker.failingInitialization = -1
  FakeShardWorker.hangingInitialization = -1
  FakeShardWorker.crashingCommand = ""
  FakeShardWorker.snapshotResponses = false
  vi.stubGlobal("Worker", FakeShardWorker)
})

describe("MulticoreWasmTrainingEngine lifecycle", () => {
  it("terminates every live shard and exports its coordinator checkpoint", async () => {
    const topology = createTestTopology()
    const config = createTrainingConfig({ populationSize: 130, workerCount: 3, backend: "wasm-simd" })
    const population = createSeededInitialPopulation(topology, config.populationSize, config.seed, 1)
    const engine = await MulticoreWasmTrainingEngine.create(topology, config, population, 1, "wasm-simd")

    expect(FakeShardWorker.instances).toHaveLength(3)
    expect(engine.exportState().population).toBe(population)
    engine.dispose()
    expect(FakeShardWorker.instances.every((worker) => worker.terminated)).toBe(true)
  })

  it("cleans up all shards when pool initialization fails partway through", async () => {
    FakeShardWorker.failingInitialization = 1
    const topology = createTestTopology()
    const config = createTrainingConfig({ populationSize: 130, workerCount: 3, backend: "wasm-simd" })
    const population = createSeededInitialPopulation(topology, config.populationSize, config.seed, 1)

    await expect(MulticoreWasmTrainingEngine.create(topology, config, population, 1, "wasm-simd"))
      .rejects.toThrow("initialization failed")
    expect(FakeShardWorker.instances).toHaveLength(2)
    expect(FakeShardWorker.instances.every((worker) => worker.terminated)).toBe(true)
  })

  it("times out a stuck shard and rejects initialization without leaking it", async () => {
    vi.useFakeTimers()
    FakeShardWorker.hangingInitialization = 0
    const topology = createTestTopology()
    const config = createTrainingConfig({ populationSize: 64, workerCount: 1, backend: "wasm-simd" })
    const creating = MulticoreWasmTrainingEngine.create(topology, config, undefined, 1, "wasm-simd")
    const rejection = expect(creating).rejects.toThrow("timed out")

    await vi.advanceTimersByTimeAsync(30_000)

    await rejection
    expect(FakeShardWorker.instances).toHaveLength(1)
    expect(FakeShardWorker.instances[0].terminated).toBe(true)
    vi.useRealTimers()
  })

  it("retains a fallback checkpoint and rejects later work after a shard crash", async () => {
    const topology = createTestTopology()
    const config = createTrainingConfig({ populationSize: 64, workerCount: 1, backend: "wasm-simd" })
    const population = createSeededInitialPopulation(topology, config.populationSize, config.seed, 1)
    const engine = await MulticoreWasmTrainingEngine.create(topology, config, population, 1, "wasm-simd")
    const worker = FakeShardWorker.instances[0]
    FakeShardWorker.crashingCommand = "run"

    await expect(engine.runChunk(1, 10)).rejects.toThrow("shard crashed")
    const requestsAfterCrash = worker.postCount
    await expect(engine.runChunk(1, 10)).rejects.toThrow("shard crashed")

    expect(worker.postCount).toBe(requestsAfterCrash)
    expect(engine.exportState().population).toBe(population)
    expect(worker.terminated).toBe(true)
    engine.dispose()
  })

  it("bounds live shards across repeated large-population reconfiguration cycles", async () => {
    for (const [populationSize, workerCount] of [[500, 8], [2_000, 12]] as const) {
      const topology = createTestTopology()
      const config = createTrainingConfig({ populationSize, workerCount, backend: "wasm-simd" })
      const before = FakeShardWorker.instances.length
      const engine = await MulticoreWasmTrainingEngine.create(topology, config, undefined, 1, "wasm-simd")
      const created = FakeShardWorker.instances.slice(before)
      expect(created).toHaveLength(workerCount)
      expect(created.filter((worker) => !worker.terminated)).toHaveLength(workerCount)
      engine.dispose()
      expect(created.every((worker) => worker.terminated)).toBe(true)
    }
  })

  it("merges the global top five render candidates instead of one per shard", async () => {
    FakeShardWorker.snapshotResponses = true
    const topology = createTestTopology()
    const config = createTrainingConfig({ populationSize: 130, workerCount: 3, backend: "wasm-simd" })
    const engine = await MulticoreWasmTrainingEngine.create(topology, config, undefined, 1, "wasm-simd")

    await engine.runChunk(1, 10)
    const render = engine.getSnapshot("running", true).render

    expect(render?.creatureCount).toBe(5)
    expect(Array.from(render?.centers ?? []).filter((_, index) => index % 2 === 0)).toEqual([201, 200, 101, 100, 1])
    engine.dispose()
  })
})
