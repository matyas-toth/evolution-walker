/**
 * Main creature editor component orchestrating toolbar, canvas, and properties panel.
 * Wires up editor state hook with all sub-components and handles save.
 * @module components/editor/CreatureEditor
 */

"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Save, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useEditorState } from "@/hooks/useEditorState"
import { EditorToolbar } from "./EditorToolbar"
import { EditorCanvas } from "./EditorCanvas"
import { PropertiesPanel } from "./PropertiesPanel"
import type { Topology } from "@/core/types"

interface CreatureEditorProps {
    creatureId: string
    initialName: string
    initialTopology: Topology
}

export function CreatureEditor({ creatureId, initialName, initialTopology }: CreatureEditorProps) {
    const router = useRouter()
    const { state, dispatch, addParticle, addConstraint, addMuscle } = useEditorState(initialTopology)
    const [name, setName] = useState(initialName)
    const [saving, setSaving] = useState(false)
    const [lastSaved, setLastSaved] = useState<Date | null>(null)

    const handleSave = useCallback(async () => {
        setSaving(true)
        try {
            const res = await fetch(`/api/creatures/${creatureId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, topology: state.topology }),
            })
            if (res.ok) setLastSaved(new Date())
        } finally {
            setSaving(false)
        }
    }, [creatureId, name, state.topology])

    const handleCanvasClick = useCallback((worldX: number, worldY: number) => {
        if (state.tool === "particle") {
            addParticle(Math.round(worldX), Math.round(worldY))
        } else if (state.tool === "select") {
            dispatch({ type: "SELECT", element: null })
        }
    }, [state.tool, addParticle, dispatch])

    const handleParticleClick = useCallback((id: string) => {
        if (state.tool === "select") {
            dispatch({ type: "SELECT", element: { type: "particle", id } })
        } else if (state.tool === "constraint" || state.tool === "muscle") {
            if (!state.pendingConnection) {
                dispatch({ type: "SET_PENDING", particleId: id })
            } else if (state.pendingConnection !== id) {
                const p1 = state.topology.particles.find((p) => p.id === state.pendingConnection)
                const p2 = state.topology.particles.find((p) => p.id === id)
                if (p1 && p2) {
                    const dist = Math.hypot(p2.initialPos.x - p1.initialPos.x, p2.initialPos.y - p1.initialPos.y)
                    if (state.tool === "constraint") {
                        addConstraint(state.pendingConnection, id, dist)
                    } else {
                        addMuscle(state.pendingConnection, id, dist)
                    }
                }
            } else {
                dispatch({ type: "SET_PENDING", particleId: null })
            }
        } else if (state.tool === "delete") {
            dispatch({ type: "DELETE_ELEMENT", elementType: "particle", id })
        }
    }, [state.tool, state.pendingConnection, state.topology.particles, dispatch, addConstraint, addMuscle])

    const handleConstraintClick = useCallback((id: string) => {
        if (state.tool === "select") dispatch({ type: "SELECT", element: { type: "constraint", id } })
        else if (state.tool === "delete") dispatch({ type: "DELETE_ELEMENT", elementType: "constraint", id })
    }, [state.tool, dispatch])

    const handleMuscleClick = useCallback((id: string) => {
        if (state.tool === "select") dispatch({ type: "SELECT", element: { type: "muscle", id } })
        else if (state.tool === "delete") dispatch({ type: "DELETE_ELEMENT", elementType: "muscle", id })
    }, [state.tool, dispatch])

    const handleParticleDrag = useCallback((id: string, x: number, y: number) => {
        dispatch({ type: "MOVE_PARTICLE", id, x: Math.round(x), y: Math.round(y) })
    }, [dispatch])

    const handleParticleDragEnd = useCallback(() => {
        // Commit the drag to history by pushing a snapshot
    }, [])

    return (
        <div className="flex flex-col h-screen overflow-hidden">
            <div className="flex items-center justify-between h-14 px-4 border-b border-border bg-card shrink-0">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push("/dashboard/creatures")}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <Input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="h-8 w-48 text-sm font-medium bg-transparent border-transparent hover:border-border focus:border-border"
                    />
                </div>
                <div className="flex items-center gap-3">
                    {lastSaved && (
                        <span className="text-xs text-muted-foreground">
                            Saved {lastSaved.toLocaleTimeString()}
                        </span>
                    )}
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-2 h-3.5 w-3.5" />}
                        {saving ? "Saving..." : "Save"}
                    </Button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                <div className="flex items-start p-3">
                    <EditorToolbar
                        tool={state.tool}
                        onToolChange={(tool) => dispatch({ type: "SET_TOOL", tool })}
                        onUndo={() => dispatch({ type: "UNDO" })}
                        onRedo={() => dispatch({ type: "REDO" })}
                        canUndo={state.historyIndex > 0}
                        canRedo={state.historyIndex < state.history.length - 1}
                        isPreviewMode={state.isPreviewMode}
                        onTogglePreview={() => dispatch({ type: "TOGGLE_PREVIEW" })}
                    />
                </div>

                <EditorCanvas
                    topology={state.topology}
                    tool={state.tool}
                    selected={state.selected}
                    pendingConnection={state.pendingConnection}
                    isPreviewMode={state.isPreviewMode}
                    onCanvasClick={handleCanvasClick}
                    onParticleClick={handleParticleClick}
                    onConstraintClick={handleConstraintClick}
                    onMuscleClick={handleMuscleClick}
                    onParticleDrag={handleParticleDrag}
                    onParticleDragEnd={handleParticleDragEnd}
                />

                <PropertiesPanel
                    topology={state.topology}
                    selected={state.selected}
                    tool={state.tool}
                    onUpdateParticle={(id, updates) => dispatch({ type: "UPDATE_PARTICLE", id, updates })}
                    onUpdateConstraint={(id, updates) => dispatch({ type: "UPDATE_CONSTRAINT", id, updates })}
                    onUpdateMuscle={(id, updates) => dispatch({ type: "UPDATE_MUSCLE", id, updates })}
                />
            </div>
        </div>
    )
}
