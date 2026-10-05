// @vitest-environment jsdom
import { act, renderHook, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { useEditorState } from "@/hooks/useEditorState"
import { PropertiesPanel } from "@/components/editor/PropertiesPanel"
import { createTestTopology } from "../fixtures/training"

describe("editor topology invariants", () => {
    it("avoids sparse, imported, deleted and rapidly allocated particle IDs", () => {
        const topology = createTestTopology()
        topology.particles.push({ ...topology.particles[1], id: "particle-4" })
        const { result } = renderHook(() => useEditorState(topology))
        act(() => { result.current.addParticle(0, 0); result.current.addParticle(1, 1) })
        expect(result.current.state.topology.particles.map(p => p.id)).toEqual(["head", "foot", "particle-4", "particle-5", "particle-6"])
        act(() => result.current.dispatch({ type: "DELETE_ELEMENT", elementType: "particle", id: "particle-5" }))
        const imported = createTestTopology()
        imported.particles.push({ ...imported.particles[0], id: "particle-7" })
        act(() => result.current.dispatch({ type: "SET_TOPOLOGY", topology: imported }))
        act(() => result.current.addParticle(2, 2))
        expect(result.current.state.topology.particles.at(-1)?.id).toBe("particle-8")
    })

    it("rejects duplicate particle insertion without altering existing links", () => {
        const topology = createTestTopology()
        const { result } = renderHook(() => useEditorState(topology))
        act(() => result.current.dispatch({ type: "ADD_PARTICLE", particle: topology.particles[0] }))
        expect(result.current.state.topology).toEqual(topology)
    })

    it("updates constraint and muscle lengths on dragging and numeric position editing", () => {
        const topology = createTestTopology()
        const { result } = renderHook(() => useEditorState(topology))
        act(() => result.current.dispatch({ type: "MOVE_PARTICLE", id: "foot", x: 0, y: 10 }))
        expect(result.current.state.topology.constraints[0].restLength).toBe(30)
        expect(result.current.state.topology.muscles[0].baseLength).toBe(30)
        act(() => result.current.dispatch({ type: "UPDATE_PARTICLE", id: "head", updates: { initialPos: { x: 40, y: 10 } } }))
        expect(result.current.state.topology.constraints[0]).toMatchObject({ restLength: 40, stiffness: 0.9, damping: 0 })
        expect(result.current.state.topology.muscles[0]).toMatchObject({ baseLength: 40, stiffness: 0.9, damping: 0 })
    })

    it.each(["constraint", "muscle"] as const)("shows %s length read-only and hides material settings", type => {
        const topology = createTestTopology()
        render(<PropertiesPanel topology={topology} selected={{ type, id: type === "muscle" ? "muscle" : "bone" }} tool="select" onUpdateParticle={vi.fn()} />)
        expect(screen.getByText(/Length \(automatic\)/)).toBeVisible()
        expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument()
        expect(screen.queryByText("Stiffness")).not.toBeInTheDocument()
        expect(screen.queryByText("Damping")).not.toBeInTheDocument()
    })
})
