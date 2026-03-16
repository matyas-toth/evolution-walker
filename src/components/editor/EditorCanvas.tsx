/**
 * Interactive canvas for the creature editor.
 * Handles rendering of particles, constraints, muscles, grid, selection, and all mouse interactions.
 * Supports pan (middle-click/space+drag), zoom (scroll), particle placement, connection creation, and drag-to-move.
 * @module components/editor/EditorCanvas
 */

"use client"

import { useRef, useEffect, useCallback, useState } from "react"
import type { Topology, Creature } from "@/core/types"
import type { EditorTool, SelectedElement } from "@/hooks/useEditorState"
import { loadPhysicsWasm, stepPhysicsWasm } from "@/core/physics/wasmGlue"

interface Camera { x: number; y: number; zoom: number }

interface EditorCanvasProps {
    topology: Topology
    tool: EditorTool
    selected: SelectedElement | null
    pendingConnection: string | null
    isPreviewMode: boolean
    onCanvasClick: (worldX: number, worldY: number) => void
    onParticleClick: (id: string) => void
    onConstraintClick: (id: string) => void
    onMuscleClick: (id: string) => void
    onParticleDrag: (id: string, x: number, y: number) => void
    onParticleDragEnd: () => void
}

const GRID_SIZE = 20
const PARTICLE_HIT_RADIUS = 12
const LINE_HIT_DISTANCE = 8

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
    const dx = x2 - x1, dy = y2 - y1
    const len2 = dx * dx + dy * dy
    if (len2 === 0) return Math.hypot(px - x1, py - y1)
    let t = ((px - x1) * dx + (py - y1) * dy) / len2
    t = Math.max(0, Math.min(1, t))
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

export function EditorCanvas({
    topology, tool, selected, pendingConnection, isPreviewMode,
    onCanvasClick, onParticleClick, onConstraintClick, onMuscleClick,
    onParticleDrag, onParticleDragEnd,
}: EditorCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const cameraRef = useRef<Camera>({ x: 0, y: 0, zoom: 1 })
    const mouseRef = useRef({ x: 0, y: 0, worldX: 0, worldY: 0 })
    const dragRef = useRef<{ particleId: string; startX: number; startY: number } | null>(null)
    const panRef = useRef<{ startX: number; startY: number; camX: number; camY: number } | null>(null)
    const [hovered, setHovered] = useState<SelectedElement | null>(null)
    const spaceRef = useRef(false)
    const animationRef = useRef<number>(0)

    // Physics state
    const previewTopologyRef = useRef<Topology | null>(null)
    const previewCreatureRef = useRef<Creature | null>(null)
    const lastTimeRef = useRef<number>(0)
    const timeAccumulatorRef = useRef<number>(0)
    const totalStepsRef = useRef<number>(0)
    const [isWasmReady, setIsWasmReady] = useState(false)

    // Ensure wasm is loaded
    useEffect(() => {
        loadPhysicsWasm().then(() => setIsWasmReady(true))
    }, [])

    // Initialize or clear preview clone when toggling preview mode
    useEffect(() => {
        if (isPreviewMode) {
            const clone = JSON.parse(JSON.stringify(topology)) as Topology
            previewTopologyRef.current = clone
            previewCreatureRef.current = {
                id: "preview",
                particles: clone.particles.map(p => ({
                    ...p,
                    pos: { ...p.initialPos },
                    prevPos: { ...p.initialPos },
                    oldPos: { ...p.initialPos },
                    velocity: { x: 0, y: 0 },
                    friction: 0.1,
                })),
                constraints: clone.constraints.map(c => ({
                    ...c,
                    targetLength: c.restLength
                })),
                muscles: clone.muscles.map(m => ({
                    ...m,
                    activation: 0,
                    phase: 0,
                    isMuscle: true,
                    amplitude: 0.2,
                    frequency: 2.0,
                    currentLength: m.baseLength,
                    restLength: m.baseLength,
                })),
                fitness: { total: 0, distance: 0, targetBonus: 0, efficiency: 0, stability: 0 },
                isDead: false,
                currentPos: { x: 0, y: 0 },
                minHeadY: 0,
                genome: [],
                particleMap: new Map(),
                startPos: { x: 0, y: 0 },
                maxDistance: 0,
                reachedTarget: false,
            }
            lastTimeRef.current = performance.now()
            timeAccumulatorRef.current = 0
            totalStepsRef.current = 0
            // Reset camera slightly if needed? For now just keep current camera
        } else {
            previewTopologyRef.current = null
            previewCreatureRef.current = null
        }
    }, [isPreviewMode, topology])

    const screenToWorld = useCallback((sx: number, sy: number) => {
        const cam = cameraRef.current
        return {
            x: (sx - cam.x) / cam.zoom,
            y: (sy - cam.y) / cam.zoom,
        }
    }, [])

    const worldToScreen = useCallback((wx: number, wy: number) => {
        const cam = cameraRef.current
        return {
            x: wx * cam.zoom + cam.x,
            y: wy * cam.zoom + cam.y,
        }
    }, [])

    const hitTest = useCallback((sx: number, sy: number): SelectedElement | null => {
        const { x: wx, y: wy } = screenToWorld(sx, sy)
        const zoom = cameraRef.current.zoom
        const pHitR = PARTICLE_HIT_RADIUS / zoom
        const lHitD = LINE_HIT_DISTANCE / zoom

        const currentTopology = isPreviewMode && previewTopologyRef.current ? previewTopologyRef.current : topology

        for (const p of currentTopology.particles) {
            const dx = p.initialPos.x - wx, dy = p.initialPos.y - wy
            if (Math.sqrt(dx * dx + dy * dy) < pHitR) {
                return { type: "particle", id: p.id }
            }
        }

        const pMap = new Map(currentTopology.particles.map((p) => [p.id, p]))

        for (const m of currentTopology.muscles) {
            const p1 = pMap.get(m.p1Id), p2 = pMap.get(m.p2Id)
            if (!p1 || !p2) continue
            if (distToSegment(wx, wy, p1.initialPos.x, p1.initialPos.y, p2.initialPos.x, p2.initialPos.y) < lHitD) {
                return { type: "muscle", id: m.id }
            }
        }

        for (const c of currentTopology.constraints) {
            const p1 = pMap.get(c.p1Id), p2 = pMap.get(c.p2Id)
            if (!p1 || !p2) continue
            if (distToSegment(wx, wy, p1.initialPos.x, p1.initialPos.y, p2.initialPos.x, p2.initialPos.y) < lHitD) {
                return { type: "constraint", id: c.id }
            }
        }

        return null
    }, [topology, screenToWorld, isPreviewMode])

    const drawScene = useCallback((ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, currentTopology: Topology) => {
        const dpr = window.devicePixelRatio || 1
        const w = canvas.offsetWidth, h = canvas.offsetHeight
        canvas.width = w * dpr
        canvas.height = h * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, w, h)

        const cam = cameraRef.current
        const gridStep = GRID_SIZE * cam.zoom
        const offsetX = cam.x % gridStep
        const offsetY = cam.y % gridStep

        ctx.strokeStyle = "oklch(0.20 0.005 260)"
        ctx.lineWidth = 0.5
        for (let x = offsetX; x < w; x += gridStep) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
        }
        for (let y = offsetY; y < h; y += gridStep) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
        }

        const origin = worldToScreen(0, 0)
        ctx.strokeStyle = "oklch(0.30 0.01 260)"
        ctx.lineWidth = 1
        ctx.setLineDash([4, 4])
        ctx.beginPath(); ctx.moveTo(0, origin.y); ctx.lineTo(w, origin.y); ctx.stroke()
        ctx.beginPath(); ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, h); ctx.stroke()
        ctx.setLineDash([])

        const pMap = new Map(currentTopology.particles.map((p) => [p.id, p]))

        ctx.lineCap = "round"
        for (const c of currentTopology.constraints) {
            const p1 = pMap.get(c.p1Id), p2 = pMap.get(c.p2Id)
            if (!p1 || !p2) continue
            const s1 = worldToScreen(p1.initialPos.x, p1.initialPos.y)
            const s2 = worldToScreen(p2.initialPos.x, p2.initialPos.y)
            const isSel = selected?.type === "constraint" && selected.id === c.id
            const isHov = hovered?.type === "constraint" && hovered.id === c.id
            ctx.strokeStyle = isSel ? "oklch(0.85 0.02 260)" : isHov ? "oklch(0.65 0.01 260)" : "oklch(0.45 0.01 260)"
            ctx.lineWidth = isSel ? 3 : 2
            ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke()
        }

        for (const m of currentTopology.muscles) {
            const p1 = pMap.get(m.p1Id), p2 = pMap.get(m.p2Id)
            if (!p1 || !p2) continue
            const s1 = worldToScreen(p1.initialPos.x, p1.initialPos.y)
            const s2 = worldToScreen(p2.initialPos.x, p2.initialPos.y)
            const isSel = selected?.type === "muscle" && selected.id === m.id
            const isHov = hovered?.type === "muscle" && hovered.id === m.id
            ctx.strokeStyle = isSel ? "oklch(0.80 0.20 162)" : isHov ? "oklch(0.72 0.17 162 / 0.9)" : "oklch(0.72 0.17 162 / 0.6)"
            ctx.lineWidth = isSel ? 4 : 3
            ctx.beginPath(); ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y); ctx.stroke()
        }

        if (pendingConnection) {
            const p = pMap.get(pendingConnection)
            if (p) {
                const s = worldToScreen(p.initialPos.x, p.initialPos.y)
                const color = tool === "muscle" ? "oklch(0.72 0.17 162 / 0.4)" : "oklch(0.65 0.01 260 / 0.4)"
                ctx.strokeStyle = color
                ctx.lineWidth = 2
                ctx.setLineDash([6, 4])
                ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(mouseRef.current.x, mouseRef.current.y); ctx.stroke()
                ctx.setLineDash([])
            }
        }

        for (const p of currentTopology.particles) {
            const s = worldToScreen(p.initialPos.x, p.initialPos.y)
            const r = Math.max(4, p.radius * cam.zoom * 0.4)
            const isSel = selected?.type === "particle" && selected.id === p.id
            const isHov = hovered?.type === "particle" && hovered.id === p.id
            const isPending = pendingConnection === p.id

            if (isSel || isPending) {
                ctx.fillStyle = "oklch(0.72 0.17 162 / 0.15)"
                ctx.beginPath(); ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2); ctx.fill()
                ctx.strokeStyle = "oklch(0.72 0.17 162 / 0.5)"
                ctx.lineWidth = 1.5
                ctx.beginPath(); ctx.arc(s.x, s.y, r + 8, 0, Math.PI * 2); ctx.stroke()
            }

            ctx.fillStyle = isSel ? "oklch(0.90 0.05 162)" : isHov ? "oklch(0.85 0.02 260)" : p.isLocked ? "oklch(0.60 0.15 25)" : "oklch(0.80 0.02 260)"
            ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2); ctx.fill()

            if (cam.zoom > 0.6) {
                ctx.fillStyle = "oklch(0.50 0.01 260)"
                ctx.font = `${Math.max(9, 10 * cam.zoom)}px var(--font-geist-mono), monospace`
                ctx.textAlign = "center"
                ctx.fillText(p.id, s.x, s.y - r - 6)
            }
        }

        ctx.fillStyle = "oklch(0.45 0.01 260)"
        ctx.font = "11px var(--font-geist-mono), monospace"
        ctx.textAlign = "left"
        ctx.fillText(`${Math.round(cam.zoom * 100)}%`, 8, h - 8)
    }, [selected, hovered, pendingConnection, tool, worldToScreen])

    useEffect(() => {
        const loop = (time: number) => {
            animationRef.current = requestAnimationFrame(loop)
            const canvas = canvasRef.current
            const ctx = canvas?.getContext("2d")
            if (!canvas || !ctx) return

            // --- Physics Update ---
            if (isPreviewMode && isWasmReady && previewCreatureRef.current && previewTopologyRef.current) {
                let deltaTimeMs = time - lastTimeRef.current
                lastTimeRef.current = time
                if (deltaTimeMs > 1000) deltaTimeMs = 16 // Prevent spiral of death

                timeAccumulatorRef.current += deltaTimeMs

                // Fixed timestep physics (60hz)
                const FIXED_TIMESTEP = 1 / 60
                const stepTimeMs = FIXED_TIMESTEP * 1000

                // Maximum of 10 steps per frame to prevent freezing on severe lag
                let stepsToDo = 0
                while (timeAccumulatorRef.current >= stepTimeMs && stepsToDo < 10) {
                    timeAccumulatorRef.current -= stepTimeMs
                    stepsToDo++
                }

                if (stepsToDo > 0) {
                    const ground = { y: 200, friction: 0.7, restitution: 0.3 }
                    const walls = [{ x: -400, normal: { x: 1, y: 0 } }, { x: 400, normal: { x: -1, y: 0 } }]

                    for (let i = 0; i < stepsToDo; i++) {
                        previewCreatureRef.current.muscles.forEach(m => { m.stiffness = 0.9 })
                        stepPhysicsWasm(
                            previewCreatureRef.current, ground, walls, FIXED_TIMESTEP,
                            { forceY: 200, airResistance: 0.02, constraintIterations: 3, time: (totalStepsRef.current + i) * FIXED_TIMESTEP }
                        )
                    }
                    totalStepsRef.current += stepsToDo

                    // Sync changes back to the draw topology clone
                    for (let i = 0; i < previewTopologyRef.current.particles.length; i++) {
                        previewTopologyRef.current.particles[i].initialPos.x = previewCreatureRef.current.particles[i].pos.x
                        previewTopologyRef.current.particles[i].initialPos.y = previewCreatureRef.current.particles[i].pos.y
                    }
                }
            }

            const activeTopology = isPreviewMode && previewTopologyRef.current ? previewTopologyRef.current : topology
            drawScene(ctx, canvas, activeTopology)
        }

        animationRef.current = requestAnimationFrame(loop)
        return () => cancelAnimationFrame(animationRef.current)
    }, [drawScene, isPreviewMode, isWasmReady, topology])

    useEffect(() => {
        const container = containerRef.current
        if (!container) return

        const cam = cameraRef.current
        const rect = container.getBoundingClientRect()
        cam.x = rect.width / 2
        cam.y = rect.height / 2
    }, [])

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => { if (e.code === "Space") spaceRef.current = true }
        const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spaceRef.current = false }
        window.addEventListener("keydown", onKeyDown)
        window.addEventListener("keyup", onKeyUp)
        return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp) }
    }, [])

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (isPreviewMode) return
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top

        if (e.button === 1 || spaceRef.current) {
            panRef.current = { startX: e.clientX, startY: e.clientY, camX: cameraRef.current.x, camY: cameraRef.current.y }
            e.preventDefault()
            return
        }

        if (e.button !== 0) return

        const hit = hitTest(sx, sy)

        if (tool === "select") {
            if (hit?.type === "particle") {
                onParticleClick(hit.id)
                const p = topology.particles.find((p) => p.id === hit.id)
                if (p) dragRef.current = { particleId: hit.id, startX: p.initialPos.x, startY: p.initialPos.y }
            } else if (hit?.type === "constraint") {
                onConstraintClick(hit.id)
            } else if (hit?.type === "muscle") {
                onMuscleClick(hit.id)
            } else {
                onCanvasClick(0, 0)
            }
        } else if (tool === "particle") {
            const { x, y } = screenToWorld(sx, sy)
            onCanvasClick(x, y)
        } else if (tool === "constraint" || tool === "muscle") {
            if (hit?.type === "particle") {
                onParticleClick(hit.id)
            }
        } else if (tool === "delete") {
            if (hit) {
                if (hit.type === "particle") onParticleClick(hit.id)
                else if (hit.type === "constraint") onConstraintClick(hit.id)
                else if (hit.type === "muscle") onMuscleClick(hit.id)
            }
        }
    }, [tool, topology, hitTest, screenToWorld, onCanvasClick, onParticleClick, onConstraintClick, onMuscleClick, isPreviewMode])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (isPreviewMode) return
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top
        mouseRef.current.x = sx
        mouseRef.current.y = sy
        const w = screenToWorld(sx, sy)
        mouseRef.current.worldX = w.x
        mouseRef.current.worldY = w.y

        if (panRef.current) {
            cameraRef.current.x = panRef.current.camX + (e.clientX - panRef.current.startX)
            cameraRef.current.y = panRef.current.camY + (e.clientY - panRef.current.startY)
            return
        }

        if (dragRef.current && tool === "select") {
            onParticleDrag(dragRef.current.particleId, w.x, w.y)
            return
        }

        const hit = hitTest(sx, sy)
        setHovered(hit)
    }, [tool, hitTest, screenToWorld, onParticleDrag])

    const handleMouseUp = useCallback(() => {
        if (dragRef.current) {
            onParticleDragEnd()
            dragRef.current = null
        }
        panRef.current = null
    }, [onParticleDragEnd])

    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top
        const cam = cameraRef.current
        const factor = e.deltaY > 0 ? 0.9 : 1.1
        const newZoom = Math.max(0.2, Math.min(5, cam.zoom * factor))
        cam.x = sx - (sx - cam.x) * (newZoom / cam.zoom)
        cam.y = sy - (sy - cam.y) * (newZoom / cam.zoom)
        cam.zoom = newZoom
    }, [])

    const cursor = tool === "particle" ? "crosshair"
        : tool === "delete" ? "not-allowed"
            : (tool === "constraint" || tool === "muscle") ? "cell"
                : hovered ? "pointer" : "default"

    return (
        <div ref={containerRef} className="flex-1 relative overflow-hidden bg-background">
            <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full"
                style={{ cursor }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
                onContextMenu={(e) => e.preventDefault()}
            />
        </div>
    )
}
