// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, it, vi } from "vitest"
import { createTestTopology } from "../fixtures/training"

const push = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }))
vi.mock("@/components/editor/EditorCanvas", () => ({ EditorCanvas: () => <div>Editor canvas</div> }))
import { CreatureEditor } from "@/components/editor/CreatureEditor"

beforeEach(() => vi.stubGlobal("fetch", vi.fn()))

it("saves the current creature before navigating directly to training", async () => {
    const topology = createTestTopology()
    vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 200 }))
    render(<CreatureEditor creatureId="walker" initialName="Old" initialTopology={topology} />)
    await userEvent.clear(screen.getByLabelText("Creature name"))
    await userEvent.type(screen.getByLabelText("Creature name"), "New")
    await userEvent.click(screen.getByRole("button", { name: "Train" }))
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard/creatures/walker/train"))
    expect(fetch).toHaveBeenCalledWith("/api/creatures/walker", expect.objectContaining({
        method: "PATCH", body: JSON.stringify({ name: "New", topology }),
    }))
})

it.each(["http", "network"])("does not navigate when saving fails (%s)", async failure => {
    if (failure === "http") vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 500 }))
    else vi.mocked(fetch).mockRejectedValue(new Error("Offline"))
    render(<CreatureEditor creatureId="walker" initialName="Old" initialTopology={createTestTopology()} />)
    await userEvent.click(screen.getByRole("button", { name: "Train" }))
    expect(await screen.findByRole("alert")).toBeVisible()
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Train" })).toBeEnabled()
})
