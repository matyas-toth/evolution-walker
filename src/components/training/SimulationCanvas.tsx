"use client"

import { useEffect, useRef } from "react"
import type { Creature } from "@/core/types"

interface SimulationCanvasProps {
    creatures: Creature[]
    groundY: number
    targetZone: { x: number; y: number; width: number; height: number }
    showCount?: number
}

function getCreatureColor(index: number, total: number): string {
    return `hsl(${(index * 360) / total}, 78%, 58%)`
}

export function SimulationCanvas({ creatures, groundY, targetZone, showCount = 5 }: SimulationCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        // Handle resize
        const resize = () => {
            const rect = container.getBoundingClientRect()
            canvas.width = rect.width
            canvas.height = rect.height
        }
        resize()
        window.addEventListener("resize", resize)

        const render = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height)

            // Preserve original index to render consistent colors
            const withIndex = creatures.map((c, i) => ({ creature: c, originalIndex: i }))

            // Sort by current X position in real time (the proxy for fitness during the generation)
            withIndex.sort((a, b) => (a.creature.currentPos?.x ?? 0) - (b.creature.currentPos?.x ?? 0))

            // Only draw top N (which are at the end of the array due to ascending sort)
            const toDraw = withIndex.slice(-showCount)

            // Camera tracking
            let sumX = 0
            for (const item of toDraw) {
                sumX += (item.creature.currentPos?.x || 100)
            }
            const avgX = toDraw.length > 0 ? sumX / toDraw.length : 100

            ctx.save()

            // Scale so groundY is at 80% of canvas height
            const targetGroundVisualY = canvas.height * 0.8
            const scale = targetGroundVisualY / groundY

            ctx.scale(scale, scale)

            // Center camera on avgX
            const canvasCenterX = canvas.width / scale / 2
            const cameraX = Math.max(0, avgX - canvasCenterX + 100) // Keep a bit of padding to the left

            ctx.translate(-cameraX, 0)

            // Draw Target Zone
            ctx.fillStyle = "rgba(46, 204, 113, 0.2)"
            ctx.fillRect(targetZone.x, targetZone.y, targetZone.width, targetZone.height)
            ctx.strokeStyle = "rgba(46, 204, 113, 0.5)"
            ctx.lineWidth = 2
            ctx.strokeRect(targetZone.x, targetZone.y, targetZone.width, targetZone.height)

            // Draw Ground
            ctx.strokeStyle = "oklch(0.3 0 0)"
            ctx.lineWidth = 4
            ctx.beginPath()
            ctx.moveTo(cameraX - 1000, groundY) // Extend ground infinitely
            ctx.lineTo(cameraX + (canvas.width / scale) + 1000, groundY)
            ctx.stroke()

            for (let i = 0; i < toDraw.length; i++) {
                const { creature: c, originalIndex } = toDraw[i]

                // Draw Constraints
                ctx.lineWidth = 2
                ctx.strokeStyle = "rgba(255, 255, 255, 0.3)"
                for (const cn of c.constraints) {
                    const p1 = c.particles.find(p => p.id === cn.p1Id)
                    const p2 = c.particles.find(p => p.id === cn.p2Id)
                    if (p1 && p2) {
                        ctx.beginPath()
                        ctx.moveTo(p1.pos.x, p1.pos.y)
                        ctx.lineTo(p2.pos.x, p2.pos.y)
                        ctx.stroke()
                    }
                }

                // Draw Muscles
                ctx.lineWidth = 4
                ctx.strokeStyle = "rgba(231, 76, 60, 0.6)"
                for (const m of c.muscles) {
                    const p1 = c.particles.find(p => p.id === m.p1Id)
                    const p2 = c.particles.find(p => p.id === m.p2Id)
                    if (p1 && p2) {
                        ctx.beginPath()
                        ctx.moveTo(p1.pos.x, p1.pos.y)
                        ctx.lineTo(p2.pos.x, p2.pos.y)
                        ctx.stroke()
                    }
                }

                // Draw Particles
                ctx.fillStyle = getCreatureColor(originalIndex, creatures.length)
                for (const p of c.particles) {
                    ctx.beginPath()
                    ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2)
                    ctx.fill()
                }
            }

            ctx.restore()
        }

        render()

        return () => window.removeEventListener("resize", resize)
    }, [creatures, groundY, targetZone, showCount])

    return (
        <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-background">
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
        </div>
    )
}
