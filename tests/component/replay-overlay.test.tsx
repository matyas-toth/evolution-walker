// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { ReplayOverlay } from "@/components/training/ReplayOverlay"
import { createTestTopology } from "../fixtures/training"

function renderOverlay(status: "preparing" | "error" = "preparing") {
  const onContinue = vi.fn()
  const onSaveAndExit = vi.fn()
  render(
    <ReplayOverlay
      generation={12}
      topology={createTestTopology()}
      replay={null}
      replayFrameIndex={0}
      replayProgress={status === "error" ? 0 : 0.2}
      replayStatus={status}
      replayError={status === "error" ? "device lost" : undefined}
      currentTargetDistance={1_400}
      isSaving={false}
      onSaveAndExit={onSaveAndExit}
      onContinue={onContinue}
    />,
  )
  return { onContinue, onSaveAndExit }
}

describe("ReplayOverlay", () => {
  it("keeps actions available while preparing an exact replay", async () => {
    const user = userEvent.setup()
    const { onContinue, onSaveAndExit } = renderOverlay()
    expect(screen.getByText(/Preparing exact replay/i)).toBeVisible()
    expect(screen.getByText("Generation 12")).toBeVisible()
    await user.type(screen.getByPlaceholderText("Gen 12, Target Reached"), "Winner")
    await user.click(screen.getByRole("button", { name: /Save & Exit/i }))
    expect(onSaveAndExit).toHaveBeenCalledWith("Winner")
    const target = screen.getByRole("spinbutton", { name: "New Target" })
    expect(target).toHaveValue(1900)
    await user.click(screen.getByRole("button", { name: /Continue/i }))
    expect(onContinue).toHaveBeenCalledWith(1900)
  })

  it("surfaces exact replay failures without disabling recovery actions", () => {
    renderOverlay("error")
    expect(screen.getByText("Exact replay unavailable")).toBeVisible()
    expect(screen.getByText("device lost")).toBeVisible()
    expect(screen.getByRole("button", { name: /Continue/i })).toBeEnabled()
    expect(screen.getByRole("button", { name: /Save & Exit/i })).toBeEnabled()
  })
})
