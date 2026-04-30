"use client"

import { useEffect, useRef, useState } from "react"
import { Save, ChevronRight, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import type { Creature } from "@/core/types"

const GROUND_Y = 600

/**
 * Renders the winning creature on a canvas inside the overlay.
 * Tracks the creature's center-of-mass so it stays framed.
 */
function ReplayCanvas({ creature }: { creature: Creature | null }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const canvas = canvasRef.current
        const container = containerRef.current
        if (!canvas || !container) return

        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const { width, height } = container.getBoundingClientRect()
        canvas.width = width
        canvas.height = height

        ctx.clearRect(0, 0, width, height)

        if (!creature) return

        const scale = (height * 0.75) / GROUND_Y
        const groundVisualY = height * 0.8
        const avgX = creature.currentPos?.x ?? 100
        const canvasCenterX = width / 2
        const cameraX = Math.max(0, avgX - canvasCenterX / scale)

        ctx.save()
        ctx.scale(scale, scale)
        ctx.translate(-cameraX, 0)

        // Read colors directly from theme for matching the minimal aesthetic
        // Fallback hex values in case OKLCH isn't fully supported in all canvas contexts
        const primaryColor = "oklch(0.72 0.17 162)"
        const mutedFgColor = "oklch(0.60 0.01 260)"
        const borderColor = "rgba(255, 255, 255, 0.08)"

        // Ground line
        ctx.strokeStyle = borderColor
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(cameraX - 500, GROUND_Y)
        ctx.lineTo(cameraX + width / scale + 500, GROUND_Y)
        ctx.stroke()

        // Constraints (bones)
        ctx.lineWidth = 1.5
        ctx.strokeStyle = mutedFgColor
        for (const cn of creature.constraints) {
            const p1 = creature.particles.find((p) => p.id === cn.p1Id)
            const p2 = creature.particles.find((p) => p.id === cn.p2Id)
            if (p1 && p2) {
                ctx.beginPath()
                ctx.moveTo(p1.pos.x, p1.pos.y)
                ctx.lineTo(p2.pos.x, p2.pos.y)
                ctx.stroke()
            }
        }

        // Muscles
        ctx.lineWidth = 3
        ctx.strokeStyle = primaryColor
        for (const m of creature.muscles) {
            const p1 = creature.particles.find((p) => p.id === m.p1Id)
            const p2 = creature.particles.find((p) => p.id === m.p2Id)
            if (p1 && p2) {
                ctx.beginPath()
                ctx.moveTo(p1.pos.x, p1.pos.y)
                ctx.lineTo(p2.pos.x, p2.pos.y)
                ctx.stroke()
            }
        }

        // Particles
        for (const p of creature.particles) {
            ctx.beginPath()
            ctx.arc(p.pos.x, p.pos.y, p.radius, 0, Math.PI * 2)
            ctx.fillStyle = primaryColor
            ctx.fill()
        }

        ctx.restore()
    }, [creature])

    return (
        <div ref={containerRef} className="w-full h-full">
            <canvas ref={canvasRef} className="w-full h-full" />
        </div>
    )
}

interface ReplayOverlayProps {
    generation: number
    replayCreature: Creature | null
    replayProgress: number
    currentTargetDistance: number
    isSaving: boolean
    onSaveAndExit: (runName: string) => void
    onContinue: (newTargetDistance: number) => void
}

/**
 * Minimalist scientific replay overlay shown when a creature reaches the target zone.
 */
export function ReplayOverlay({
    generation,
    replayCreature,
    replayProgress,
    currentTargetDistance,
    isSaving,
    onSaveAndExit,
    onContinue,
}: ReplayOverlayProps) {
    const [runName, setRunName] = useState("")
    const [newTarget, setNewTarget] = useState(currentTargetDistance + 500)

    useEffect(() => {
        setNewTarget(currentTargetDistance + 500)
    }, [currentTargetDistance])

    return (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center animate-in fade-in duration-700 bg-background/95">
            <Card className="w-full max-w-xl shadow-xl border-border/50 bg-card/50">
                <CardHeader className="text-center pb-4 pt-0">

                    <CardTitle className="text-2xl font-semibold tracking-tight">
                        Target Distance Reached
                    </CardTitle>
                    <CardDescription className=" text-xs uppercase tracking-wider mt-1">
                        Generation {generation}
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    <div
                        className="w-full rounded-lg overflow-hidden border border-border/50 bg-background/50 shadow-inner"
                        style={{ height: 260 }}
                    >
                        <ReplayCanvas creature={replayCreature} />
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-widest px-1">
                            <span>Replay Progress</span>
                            <span>{Math.round(replayProgress * 100)}%</span>
                        </div>
                        <Progress value={replayProgress * 100} className="h-1.5" />
                    </div>
                </CardContent>

                <CardFooter className="grid grid-cols-2 gap-4 pb-8">
                    <div className="flex flex-col gap-3">
                        <Label className="text-xs text-muted-foreground">Save & Exit</Label>
                        <Input
                            placeholder={`Gen ${generation}, Target Reached`}
                            value={runName}
                            onChange={(e) => setRunName(e.target.value)}
                            className="h-9 text-sm font-mono"
                        />
                        <Button
                            variant="secondary"
                            className="w-full font-medium gap-2"
                            onClick={() => onSaveAndExit(runName)}
                            disabled={isSaving}
                        >
                            {isSaving ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <Save className="w-4 h-4" />
                            )}
                            {isSaving ? "Saving..." : "Save & Exit"}
                        </Button>
                    </div>

                    <div className="flex flex-col gap-3">
                        <Label className="text-xs text-muted-foreground">Push Further</Label>
                        <div className="flex items-center gap-2">
                            <Label className="text-xs text-muted-foreground whitespace-nowrap sr-only">New Target:</Label>
                            <Input
                                type="number"
                                min={200}
                                max={9999}
                                step={100}
                                value={newTarget}
                                onChange={(e) => setNewTarget(Number(e.target.value))}
                                className="h-9 text-sm font-mono"
                            />
                        </div>
                        <Button
                            className="w-full font-medium gap-2"
                            onClick={() => onContinue(newTarget)}
                        >
                            <span>Continue</span>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </CardFooter>
            </Card>
        </div>
    )
}
