import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { TrainingCommand, TrainingEvent } from "@/core/types"
import { createTestTopology, createTrainingConfig } from "../fixtures/training"

let events: TrainingEvent[]
let scope: { onmessage?: (event: { data: TrainingCommand }) => void; postMessage: (event: TrainingEvent) => void; close: () => void }

async function command(data: TrainingCommand) {
    scope.onmessage!({ data })
    for (let index = 0; index < 50; index++) await Promise.resolve()
}

beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    events = []
    scope = { postMessage: event => events.push(event), close: vi.fn() }
    vi.stubGlobal("self", scope)
    vi.stubGlobal("navigator", {})
    await import("@/core/training/training.worker")
})

afterEach(async () => {
    await command({ type: "dispose" })
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("coordinator configuration migrations", () => {
    it.each(["populationSize", "generationDuration", "workerCount"] as const)("preserves search state and resumes after changing %s", async setting => {
        const config = createTrainingConfig({ generationDuration: 0.1, simulationSpeed: 1 })
        await command({ type: "init", topology: createTestTopology(), config, initialGeneration: 12 })
        await command({ type: "start" })
        await vi.advanceTimersByTimeAsync(120)
        await command({ type: "pause" })
        await command({ type: "exportSession", requestId: 1 })
        const before = events.findLast(event => event.type === "sessionExported")!
        if (before.type !== "sessionExported") throw new Error("Export missing")
        const changed = { ...config, [setting]: setting === "populationSize" ? 12 : setting === "generationDuration" ? 0.2 : 2 }
        await command({ type: "updateConfig", config: changed })
        expect(events.findLast(event => event.type === "paused")).toMatchObject({ snapshot: { phase: "paused", generation: before.state.generation } })
        await command({ type: "exportSession", requestId: 2 })
        const after = events.findLast(event => event.type === "sessionExported")!
        if (after.type !== "sessionExported") throw new Error("Export missing")
        expect(after.state.generation).toBe(before.state.generation)
        expect(after.state.policyState).toEqual(before.state.policyState)
        expect(after.state.population).toHaveLength(changed.populationSize)
        for (const genome of before.state.population) {
            expect(after.state.population.some(candidate => JSON.stringify(candidate.genes) === JSON.stringify(genome.genes))).toBe(true)
        }
        await command({ type: "start" })
        await vi.advanceTimersByTimeAsync(250)
        await command({ type: "pause" })
        await command({ type: "exportSession", requestId: 3 })
        const resumed = events.findLast(event => event.type === "sessionExported")!
        if (resumed.type !== "sessionExported") throw new Error("Export missing")
        expect(resumed.state.generation).toBeGreaterThan(before.state.generation)
        expect(events.filter(event => event.type === "error")).toEqual([])
    })

    it("shrinks a population without losing its champion", async () => {
        const config = createTrainingConfig({ populationSize: 12 })
        await command({ type: "init", topology: createTestTopology(), config })
        await command({ type: "start" })
        await vi.advanceTimersByTimeAsync(120)
        await command({ type: "pause" })
        await command({ type: "exportSession", requestId: 1 })
        const before = events.findLast(event => event.type === "sessionExported")!
        if (before.type !== "sessionExported") throw new Error("Export missing")
        await command({ type: "updateConfig", config: { ...config, populationSize: 4 } })
        await command({ type: "exportSession", requestId: 2 })
        const after = events.findLast(event => event.type === "sessionExported")!
        if (after.type !== "sessionExported") throw new Error("Export missing")
        expect(after.state.population).toHaveLength(4)
        expect(after.state.bestGenome?.genes).toEqual(before.state.bestGenome?.genes)
    })

    it("cancels a slow pending chunk so pause/resume and live speed changes take effect immediately", async () => {
        const config = createTrainingConfig({ generationDuration: 3, simulationSpeed: 0.1 })
        await command({ type: "init", topology: createTestTopology(), config })
        await command({ type: "start" })
        await vi.advanceTimersByTimeAsync(0)
        await command({ type: "pause" })
        expect(vi.getTimerCount()).toBe(0)
        await command({ type: "start" })
        await command({ type: "updateConfig", config: { ...config, simulationSpeed: 100 } })
        await vi.advanceTimersByTimeAsync(100)
        await command({ type: "pause" })
        expect(events.some(event => event.type === "generation")).toBe(true)
        expect(vi.getTimerCount()).toBe(0)
    })
})
