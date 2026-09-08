import { beforeEach, describe, expect, it, vi } from "vitest"
import { createSeededInitialPopulation } from "@/core/genetics/population"
import { MulticoreWasmTrainingEngine } from "@/core/training/MulticoreWasmTrainingEngine"
import { createTestTopology, createTrainingConfig } from "../fixtures/training"

class FakeShardWorker {
  static instances: FakeShardWorker[] = []
  static failingInitialization = -1
  static hangingInitialization = -1
  static crashingCommand = ""
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
})
