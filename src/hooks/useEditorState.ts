/**
 * Editor state management hook.
 * Handles topology editing, tool selection, undo/redo, and element selection.
 * @module hooks/useEditorState
 */

import { useReducer, useCallback, useRef } from "react"
import type { Topology, TopologyParticle, TopologyConstraint, TopologyMuscle } from "@/core/types"

export type EditorTool = "select" | "particle" | "constraint" | "muscle" | "delete"
export type ElementType = "particle" | "constraint" | "muscle"
export interface SelectedElement { type: ElementType; id: string }

interface EditorState {
    topology: Topology
    tool: EditorTool
    selected: SelectedElement | null
    pendingConnection: string | null
    history: Topology[]
    historyIndex: number
}

type EditorAction =
    | { type: "SET_TOOL"; tool: EditorTool }
    | { type: "SELECT"; element: SelectedElement | null }
    | { type: "SET_PENDING"; particleId: string | null }
    | { type: "ADD_PARTICLE"; particle: TopologyParticle }
    | { type: "ADD_CONSTRAINT"; constraint: TopologyConstraint }
    | { type: "ADD_MUSCLE"; muscle: TopologyMuscle }
    | { type: "UPDATE_PARTICLE"; id: string; updates: Partial<TopologyParticle> }
    | { type: "UPDATE_CONSTRAINT"; id: string; updates: Partial<TopologyConstraint> }
    | { type: "UPDATE_MUSCLE"; id: string; updates: Partial<TopologyMuscle> }
    | { type: "DELETE_ELEMENT"; elementType: ElementType; id: string }
    | { type: "MOVE_PARTICLE"; id: string; x: number; y: number }
    | { type: "SET_TOPOLOGY"; topology: Topology }
    | { type: "UNDO" }
    | { type: "REDO" }

function pushHistory(state: EditorState): EditorState {
    const newHistory = state.history.slice(0, state.historyIndex + 1)
    newHistory.push(JSON.parse(JSON.stringify(state.topology)))
    if (newHistory.length > 50) newHistory.shift()
    return { ...state, history: newHistory, historyIndex: newHistory.length - 1 }
}

function editorReducer(state: EditorState, action: EditorAction): EditorState {
    switch (action.type) {
        case "SET_TOOL":
            return { ...state, tool: action.tool, pendingConnection: null, selected: null }

        case "SELECT":
            return { ...state, selected: action.element }

        case "SET_PENDING":
            return { ...state, pendingConnection: action.particleId }

        case "ADD_PARTICLE": {
            const s = pushHistory(state)
            return {
                ...s,
                topology: { ...s.topology, particles: [...s.topology.particles, action.particle] },
                selected: { type: "particle", id: action.particle.id },
            }
        }

        case "ADD_CONSTRAINT": {
            const s = pushHistory(state)
            return {
                ...s,
                topology: { ...s.topology, constraints: [...s.topology.constraints, action.constraint] },
                selected: { type: "constraint", id: action.constraint.id },
                pendingConnection: null,
            }
        }

        case "ADD_MUSCLE": {
            const s = pushHistory(state)
            return {
                ...s,
                topology: { ...s.topology, muscles: [...s.topology.muscles, action.muscle] },
                selected: { type: "muscle", id: action.muscle.id },
                pendingConnection: null,
            }
        }

        case "UPDATE_PARTICLE": {
            const s = pushHistory(state)
            return {
                ...s,
                topology: {
                    ...s.topology,
                    particles: s.topology.particles.map((p) =>
                        p.id === action.id ? { ...p, ...action.updates } : p
                    ),
                },
            }
        }

        case "UPDATE_CONSTRAINT": {
            const s = pushHistory(state)
            return {
                ...s,
                topology: {
                    ...s.topology,
                    constraints: s.topology.constraints.map((c) =>
                        c.id === action.id ? { ...c, ...action.updates } : c
                    ),
                },
            }
        }

        case "UPDATE_MUSCLE": {
            const s = pushHistory(state)
            return {
                ...s,
                topology: {
                    ...s.topology,
                    muscles: s.topology.muscles.map((m) =>
                        m.id === action.id ? { ...m, ...action.updates } : m
                    ),
                },
            }
        }

        case "MOVE_PARTICLE": {
            return {
                ...state,
                topology: {
                    ...state.topology,
                    particles: state.topology.particles.map((p) =>
                        p.id === action.id ? { ...p, initialPos: { x: action.x, y: action.y } } : p
                    ),
                },
            }
        }

        case "DELETE_ELEMENT": {
            const s = pushHistory(state)
            const topo = { ...s.topology }
            if (action.elementType === "particle") {
                topo.particles = topo.particles.filter((p) => p.id !== action.id)
                topo.constraints = topo.constraints.filter((c) => c.p1Id !== action.id && c.p2Id !== action.id)
                topo.muscles = topo.muscles.filter((m) => m.p1Id !== action.id && m.p2Id !== action.id)
            } else if (action.elementType === "constraint") {
                topo.constraints = topo.constraints.filter((c) => c.id !== action.id)
            } else if (action.elementType === "muscle") {
                topo.muscles = topo.muscles.filter((m) => m.id !== action.id)
            }
            return { ...s, topology: topo, selected: null }
        }

        case "SET_TOPOLOGY":
            return { ...state, topology: action.topology, selected: null, pendingConnection: null }

        case "UNDO": {
            if (state.historyIndex <= 0) return state
            const newIndex = state.historyIndex - 1
            return {
                ...state,
                topology: JSON.parse(JSON.stringify(state.history[newIndex])),
                historyIndex: newIndex,
                selected: null,
                pendingConnection: null,
            }
        }

        case "REDO": {
            if (state.historyIndex >= state.history.length - 1) return state
            const newIndex = state.historyIndex + 1
            return {
                ...state,
                topology: JSON.parse(JSON.stringify(state.history[newIndex])),
                historyIndex: newIndex,
                selected: null,
                pendingConnection: null,
            }
        }

        default:
            return state
    }
}

export function useEditorState(initial: Topology) {
    const initialHistory = [JSON.parse(JSON.stringify(initial))]
    const [state, dispatch] = useReducer(editorReducer, {
        topology: initial,
        tool: "select",
        selected: null,
        pendingConnection: null,
        history: initialHistory,
        historyIndex: 0,
    })

    const counterRef = useRef({ particle: initial.particles.length, constraint: initial.constraints.length, muscle: initial.muscles.length })

    const nextId = useCallback((prefix: string) => {
        const key = prefix as keyof typeof counterRef.current
        counterRef.current[key]++
        return `${prefix}-${counterRef.current[key]}`
    }, [])

    const addParticle = useCallback((x: number, y: number) => {
        const id = nextId("particle")
        dispatch({
            type: "ADD_PARTICLE",
            particle: { id, initialPos: { x, y }, mass: 1.0, radius: 6, isLocked: false },
        })
    }, [nextId])

    const addConstraint = useCallback((p1Id: string, p2Id: string, restLength: number) => {
        const id = nextId("constraint")
        dispatch({
            type: "ADD_CONSTRAINT",
            constraint: { id, p1Id, p2Id, restLength, stiffness: 0.8, damping: 0.01 },
        })
    }, [nextId])

    const addMuscle = useCallback((p1Id: string, p2Id: string, baseLength: number) => {
        const id = nextId("muscle")
        dispatch({
            type: "ADD_MUSCLE",
            muscle: { id, p1Id, p2Id, baseLength, stiffness: 0.8, damping: 0.01 },
        })
    }, [nextId])

    return { state, dispatch, addParticle, addConstraint, addMuscle }
}
