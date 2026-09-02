// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TrainingSidebar } from "@/components/training/TrainingSidebar"
import { createTrainingConfig } from "../fixtures/training"
import type { TrainingDiagnostics } from "@/core/types"

const diagnostics: TrainingDiagnostics = {
  backend: "legacy",
  workerCount: 1,
  generationsPerSecond: 12.34,
  memoryBytes: 1024,
  droppedSnapshots: 2,
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

function renderSidebar(overrides: Record<string, unknown> = {}) {
  const props = {
    creatureId: "creature-1",
    config: createTrainingConfig(),
    onChangeConfig: vi.fn(),
    isRunning: false,
    isPaused: false,
    generation: 4,
    progress: 25,
    bestFitness: 99.6,
    onToggleStart: vi.fn(),
    onReset: vi.fn(),
    onSaveProgress: vi.fn().mockResolvedValue(undefined),
    hasBestGenome: true,
    diagnostics,
    engineError: null,
    pausePending: false,
    ...overrides,
  }
  return { ...render(<TrainingSidebar {...props} />), props }
}

describe("TrainingSidebar", () => {
  it("renders diagnostics and starts an idle run", async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar()
    expect(screen.getByText("legacy")).toBeVisible()
    expect(screen.getByText("12.34 gen/s")).toBeVisible()
    expect(screen.getByText("100 px")).toBeVisible()
    await user.click(screen.getByRole("button", { name: /Start Evolution/i }))
    expect(props.onToggleStart).toHaveBeenCalledOnce()
  })

  it("keeps the speed slider enabled mid-run while structural controls are disabled", () => {
    renderSidebar({ isRunning: true })
    const sliders = screen.getAllByRole("slider")
    expect(sliders[0]).toHaveAttribute("data-disabled")
    expect(sliders[1]).not.toHaveAttribute("data-disabled")
    expect(screen.getByRole("combobox", { name: "Compute Backend" })).toBeDisabled()
    expect(screen.getByRole("button", { name: /Pause Evolution/i })).toBeVisible()
  })

  it("disables speed in background mode and reports pause acknowledgement/errors", () => {
    renderSidebar({
      config: createTrainingConfig({ backgroundMode: true }),
      isPaused: true,
      pausePending: true,
      engineError: "GPU unavailable",
    })
    expect(screen.getAllByRole("slider")[1]).toHaveAttribute("data-disabled")
    expect(screen.getByText("GPU unavailable")).toBeVisible()
    expect(screen.getByRole("button", { name: /Resume/i })).toBeVisible()
  })

  it("saves a named run and forwards slider changes", async () => {
    const user = userEvent.setup()
    const { props } = renderSidebar()
    await user.type(screen.getByPlaceholderText("Run, Gen 4"), "Thesis run")
    await user.click(screen.getByRole("button", { name: "Save Current Progress" }))
    expect(props.onSaveProgress).toHaveBeenCalledWith("Thesis run")
    await user.keyboard("{Tab}")
  })
})
