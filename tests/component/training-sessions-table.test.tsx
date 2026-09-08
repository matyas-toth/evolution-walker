// @vitest-environment jsdom

import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TrainingSessionsTable } from "@/components/dashboard/TrainingSessionsTable"

describe("TrainingSessionsTable", () => {
  it("lists saved sessions from every creature with status, metrics, and resume links", () => {
    render(<TrainingSessionsTable sessions={[
      {
        id: "session-finished",
        name: "Long run",
        creatureId: "creature-one",
        creatureName: "Stickman",
        generation: 42,
        bestDistance: 1_300,
        bestFitness: 2_000,
        targetDistance: 1_400,
        reachedTarget: true,
        updatedAt: "2026-09-08T08:00:00.000Z",
      },
      {
        id: "session-progress",
        name: null,
        creatureId: "creature-two",
        creatureName: "Crawler",
        generation: 7,
        bestDistance: null,
        bestFitness: 120,
        targetDistance: 900,
        reachedTarget: false,
        updatedAt: "2026-09-07T08:00:00.000Z",
      },
    ]} />)

    expect(screen.getByText("Long run")).toBeVisible()
    expect(screen.getByText("Generation 7")).toBeVisible()
    expect(screen.getByText("Finished")).toBeVisible()
    expect(screen.getByText("In progress")).toBeVisible()
    expect(screen.getByText("1,300")).toBeVisible()
    expect(screen.getAllByRole("link", { name: /Resume/ })[0]).toHaveAttribute(
      "href",
      "/dashboard/creatures/creature-one/train?session=session-finished",
    )
  })

  it("shows a useful empty state", () => {
    render(<TrainingSessionsTable sessions={[]} />)
    expect(screen.getByText("No saved training sessions yet")).toBeVisible()
    expect(screen.getByRole("link", { name: "Choose a creature" })).toHaveAttribute("href", "/dashboard/creatures")
  })
})
