// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { TrainingHub } from "@/components/training/TrainingHub"
import { createCreature, createTestTopology } from "../fixtures/training"

const engine = vi.hoisted(() => ({ useEvolution: vi.fn() }))
vi.mock("@/hooks/useEvolution", () => engine)
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("@/app/actions/sessions", () => ({ saveTrainingSession: vi.fn() }))
vi.mock("@/hooks/useReplay", () => ({ useReplay: () => ({ frameIndex: 0, replayProgress: 0 }) }))
vi.mock("@/components/training/FitnessChart", () => ({ FitnessChart: () => null }))
vi.mock("@/components/training/ReplayOverlay", () => ({ ReplayOverlay: () => null }))

const context = {
  clearRect: vi.fn(), save: vi.fn(), restore: vi.fn(), scale: vi.fn(), translate: vi.fn(),
  fillRect: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  stroke: vi.fn(), arc: vi.fn(), fill: vi.fn(),
}

beforeEach(() => {
  context.clearRect.mockImplementation(() => context.arc.mockClear())
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D)
})

describe("Training Hub best-only rendering", () => {
  it.each(["running", "paused"])("draws only the live leader in %s mode without changing engine inputs", async phase => {
    const creatures = [100, 450, 200, 350, 300].map(x => {
      const creature = createCreature()
      creature.currentPos.x = x
      creature.particles.forEach((particle, index) => { particle.pos.x = x + index * 20 })
      return creature
    })
    const snapshot = {
      phase, generation: 7, creatures, progress: 50, fitnessHistory: [], bestCreatureEver: null,
      diagnostics: {
        backend: "legacy", workerCount: 1, generationsPerSecond: 1, memoryBytes: 0, droppedSnapshots: 0,
        stageTimings: { initializeMs: 0, simulationMs: 0, fitnessMs: 0, evolutionMs: 0, resetMs: 0, transferMs: 0, totalGenerationMs: 0 },
      },
      error: null, pausePending: false, exportSession: vi.fn(), requestReplay: vi.fn(),
      start: vi.fn(), stop: vi.fn(), continueTraining: vi.fn(), reset: vi.fn(),
    }
    engine.useEvolution.mockReturnValue(snapshot)
    const props = { creatureId: "test", creatureName: "Test Walker", topology: createTestTopology() }
    const { rerender } = render(<TrainingHub {...props} />)
    expect(context.arc).toHaveBeenCalledTimes(10)
    const originalEngineInputs = engine.useEvolution.mock.calls.at(-1)![0]
    context.arc.mockClear()

    await userEvent.click(screen.getByRole("switch", { name: "Show only the best" }))
    expect(context.arc).toHaveBeenCalledTimes(2)
    expect(context.arc.mock.calls[0][0]).toBe(450)
    expect(engine.useEvolution.mock.calls.at(-1)![0]).toEqual(originalEngineInputs)
    expect(snapshot.start).not.toHaveBeenCalled()
    expect(snapshot.stop).not.toHaveBeenCalled()
    expect(snapshot.reset).not.toHaveBeenCalled()
    expect(creatures).toHaveLength(5)

    // A later snapshot can change the leader; filtering must not pin the old winner.
    const nextLeader = createCreature()
    nextLeader.currentPos.x = 600
    nextLeader.particles.forEach((particle, index) => { particle.pos.x = 600 + index * 20 })
    engine.useEvolution.mockReturnValue({ ...snapshot, creatures: [nextLeader, ...creatures.slice(1)] })
    context.arc.mockClear()
    rerender(<TrainingHub {...props} />)
    expect(context.arc).toHaveBeenCalledTimes(2)
    expect(context.arc.mock.calls[0][0]).toBe(600)

    context.arc.mockClear()
    await userEvent.click(screen.getByRole("switch", { name: "Show only the best" }))
    expect(context.arc).toHaveBeenCalledTimes(10)
    expect(engine.useEvolution.mock.calls.at(-1)![0]).toEqual(originalEngineInputs)
  })
})
