import { beforeEach, describe, expect, it, vi } from "vitest"
import { TrainingEngineClient } from "@/core/training/TrainingEngineClient"
import type { TrainingCommand, TrainingEvent } from "@/core/types"
import { createGenome, createReplay } from "../fixtures/training"

class FakeWorker {
  static latest: FakeWorker
  onmessage: ((event: MessageEvent<TrainingEvent>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  commands: TrainingCommand[] = []
  terminated = false

  constructor() { FakeWorker.latest = this }
  postMessage(command: TrainingCommand) { this.commands.push(command) }
  terminate() { this.terminated = true }
  emit(event: TrainingEvent) { this.onmessage?.({ data: event } as MessageEvent<TrainingEvent>) }
  fail(message: string) { this.onerror?.({ message } as ErrorEvent) }
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker)
})

describe("TrainingEngineClient", () => {
  it("posts typed lifecycle commands and publishes events", () => {
    const client = new TrainingEngineClient()
    const listener = vi.fn()
    const unsubscribe = client.subscribe(listener)
    client.start()
    client.pause()
    client.reset()
    expect(FakeWorker.latest.commands.map(command => command.type)).toEqual(["start", "pause", "reset"])
    const event = { type: "backendChanged", backend: "legacy", workerCount: 1 } as const
    FakeWorker.latest.emit(event)
    expect(listener).toHaveBeenCalledWith(event)
    unsubscribe()
    FakeWorker.latest.emit(event)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("correlates concurrent export and replay requests", async () => {
    const client = new TrainingEngineClient()
    const exported = client.exportSession()
    const replayed = client.requestReplay(createGenome())
    const [exportCommand, replayCommand] = FakeWorker.latest.commands
    expect(exportCommand.type).toBe("exportSession")
    expect(replayCommand.type).toBe("requestReplay")
    if (exportCommand.type !== "exportSession" || replayCommand.type !== "requestReplay") throw new Error("unexpected command")
    const state = { population: [createGenome()], bestGenome: createGenome(), bestFitness: 10, generation: 4 }
    FakeWorker.latest.emit({ type: "replayReady", requestId: replayCommand.requestId, replay: createReplay() })
    FakeWorker.latest.emit({ type: "sessionExported", requestId: exportCommand.requestId, state })
    await expect(exported).resolves.toEqual(state)
    await expect(replayed).resolves.toEqual(createReplay())
  })

  it("rejects replay failures, worker crashes, and every pending request on dispose", async () => {
    const client = new TrainingEngineClient()
    const replay = client.requestReplay(createGenome())
    const command = FakeWorker.latest.commands[0]
    if (command.type !== "requestReplay") throw new Error("unexpected command")
    FakeWorker.latest.emit({ type: "replayFailed", requestId: command.requestId, message: "capture failed" })
    await expect(replay).rejects.toThrow("capture failed")

    const pending = client.exportSession()
    client.dispose()
    expect(FakeWorker.latest.terminated).toBe(true)
    await expect(pending).rejects.toThrow("disposed")
    const count = FakeWorker.latest.commands.length
    client.start()
    expect(FakeWorker.latest.commands).toHaveLength(count)
  })

  it("turns worker failures into fatal events", async () => {
    const client = new TrainingEngineClient()
    const listener = vi.fn()
    client.subscribe(listener)
    const pending = client.exportSession()
    FakeWorker.latest.fail("worker exploded")
    await expect(pending).rejects.toThrow("worker exploded")
    expect(listener).toHaveBeenCalledWith({ type: "error", message: "worker exploded", recoverable: false })
  })
})
