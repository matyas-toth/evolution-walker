"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Save, ChevronRight, Loader2, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { PackedTrainingReplay, Topology } from "@/core/types"

interface ReplayCanvasProps {
    topology: Topology
    replay: PackedTrainingReplay
    frameIndex: number
}

/** Renders immutable packed replay frames with the creature and target in view. */
function ReplayCanvas({ topology, replay, frameIndex }: ReplayCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const containerRef = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ width: 0, height: 0 })
    const particleIndices = useMemo(
        () => new Map(topology.particles.map((particle, index) => [particle.id, index])),
        [topology],
    )

    useEffect(() => {
        const container = containerRef.current
        if (!container) return
        const updateSize = () => {
            const rect = container.getBoundingClientRect()
            setSize({ width: rect.width, height: rect.height })
        }
        updateSize()
        const observer = new ResizeObserver(updateSize)
        observer.observe(container)
        return () => observer.disconnect()
    }, [])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas || size.width <= 0 || size.height <= 0) return
        const context = canvas.getContext("2d")
        if (!context) return

        const dpr = Math.max(1, window.devicePixelRatio || 1)
        const backingWidth = Math.round(size.width * dpr)
        const backingHeight = Math.round(size.height * dpr)
        if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
            canvas.width = backingWidth
            canvas.height = backingHeight
        }
        context.setTransform(dpr, 0, 0, dpr, 0, 0)
        context.clearRect(0, 0, size.width, size.height)

        const safeFrame = Math.max(0, Math.min(frameIndex, replay.frameCount - 1))
        const positionOffset = safeFrame * replay.particleCount * 2
        let creatureMinX = Number.POSITIVE_INFINITY
        let creatureMaxX = Number.NEGATIVE_INFINITY
        let creatureMinY = Number.POSITIVE_INFINITY
        for (let particle = 0; particle < replay.particleCount; particle++) {
            const source = positionOffset + particle * 2
            creatureMinX = Math.min(creatureMinX, replay.positions[source])
            creatureMaxX = Math.max(creatureMaxX, replay.positions[source])
            creatureMinY = Math.min(creatureMinY, replay.positions[source + 1])
        }

        const zone = replay.targetZone
        const worldMinX = Math.min(creatureMinX, zone.x)
        const worldMaxX = Math.max(creatureMaxX, zone.x + zone.width)
        const horizontalSpan = Math.max(1, worldMaxX - worldMinX)
        const horizontalPadding = Math.max(36, horizontalSpan * 0.1)
        const groundVisualY = size.height * 0.8
        const horizontalScale = (size.width - 32) / (horizontalSpan + horizontalPadding * 2)
        const verticalScale = (groundVisualY - 20) / Math.max(80, replay.groundY - creatureMinY + 28)
        const scale = Math.max(0.05, Math.min(1.25, horizontalScale, verticalScale))
        const cameraCenterX = (worldMinX + worldMaxX) / 2

        context.save()
        context.translate(size.width / 2, groundVisualY)
        context.scale(scale, scale)
        context.translate(-cameraCenterX, -replay.groundY)

        context.fillStyle = "rgba(46, 204, 113, 0.20)"
        context.fillRect(zone.x, zone.y, zone.width, zone.height)
        context.strokeStyle = "rgba(46, 204, 113, 0.70)"
        context.lineWidth = 2 / scale
        context.strokeRect(zone.x, zone.y, zone.width, zone.height)
        context.fillStyle = "rgba(46, 204, 113, 0.9)"
        context.font = `${Math.max(10, 11 / scale)}px ui-monospace, monospace`
        context.fillText("TARGET", zone.x, zone.y - 10 / scale)

        context.strokeStyle = "rgba(255, 255, 255, 0.10)"
        context.lineWidth = 2 / scale
        context.beginPath()
        context.moveTo(worldMinX - horizontalPadding, replay.groundY)
        context.lineTo(worldMaxX + horizontalPadding, replay.groundY)
        context.stroke()

        const drawConnection = (p1Id: string, p2Id: string) => {
            const p1 = particleIndices.get(p1Id)
            const p2 = particleIndices.get(p2Id)
            if (p1 === undefined || p2 === undefined) return
            const p1Offset = positionOffset + p1 * 2
            const p2Offset = positionOffset + p2 * 2
            context.beginPath()
            context.moveTo(replay.positions[p1Offset], replay.positions[p1Offset + 1])
            context.lineTo(replay.positions[p2Offset], replay.positions[p2Offset + 1])
            context.stroke()
        }

        context.lineWidth = 1.5 / scale
        context.strokeStyle = "rgba(255, 255, 255, 0.42)"
        for (const constraint of topology.constraints) drawConnection(constraint.p1Id, constraint.p2Id)

        context.lineWidth = 3 / scale
        context.strokeStyle = "oklch(0.72 0.17 162)"
        for (const muscle of topology.muscles) drawConnection(muscle.p1Id, muscle.p2Id)

        context.fillStyle = "oklch(0.72 0.17 162)"
        for (let particle = 0; particle < replay.particleCount; particle++) {
            const source = positionOffset + particle * 2
            context.beginPath()
            context.arc(
                replay.positions[source],
                replay.positions[source + 1],
                topology.particles[particle]?.radius ?? 4,
                0,
                Math.PI * 2,
            )
            context.fill()
        }
        context.restore()

        const centerX = replay.centers[safeFrame * 2]
        const remaining = Math.max(0, Math.round(zone.x - centerX))
        context.fillStyle = "rgba(255, 255, 255, 0.55)"
        context.font = "10px ui-monospace, monospace"
        context.fillText(`${remaining} units remaining`, 14, 20)
    }, [frameIndex, particleIndices, replay, size, topology])

    return (
        <div ref={containerRef} className="w-full h-full">
            <canvas ref={canvasRef} className="w-full h-full" aria-label="Exact winning trajectory replay" />
        </div>
    )
}

interface ReplayOverlayProps {
    generation: number
    topology: Topology
    replay: PackedTrainingReplay | null
    replayFrameIndex: number
    replayProgress: number
    replayStatus: "preparing" | "active" | "error"
    replayError?: string
    currentTargetDistance: number
    isSaving: boolean
    onSaveAndExit: (runName: string) => void
    onContinue: (newTargetDistance: number) => void
}

/** Victory overlay backed exclusively by the winning engine's packed trajectory. */
export function ReplayOverlay({
    generation,
    topology,
    replay,
    replayFrameIndex,
    replayProgress,
    replayStatus,
    replayError,
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
                    <CardTitle className="text-2xl font-semibold tracking-tight">Target Distance Reached</CardTitle>
                    <CardDescription className="text-xs uppercase tracking-wider mt-1">
                        Generation {generation}
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-6">
                    <div className="relative w-full rounded-lg overflow-hidden border border-border/50 bg-background/50 shadow-inner" style={{ height: 260 }}>
                        {replayStatus === "active" && replay ? (
                            <ReplayCanvas topology={topology} replay={replay} frameIndex={replayFrameIndex} />
                        ) : replayStatus === "error" ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
                                <AlertTriangle className="h-5 w-5 text-destructive" />
                                <p className="text-sm font-medium">Exact replay unavailable</p>
                                <p className="text-xs text-muted-foreground">{replayError}</p>
                            </div>
                        ) : (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground">
                                <Loader2 className="h-5 w-5 animate-spin" />
                                <p className="text-xs uppercase tracking-widest">Preparing exact replay…</p>
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-widest px-1">
                            <span>{replayStatus === "preparing" ? "Preparing Replay" : "Replay Progress"}</span>
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
                            onChange={(event) => setRunName(event.target.value)}
                            className="h-9 text-sm font-mono"
                        />
                        <Button variant="secondary" className="w-full font-medium gap-2" onClick={() => onSaveAndExit(runName)} disabled={isSaving}>
                            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            {isSaving ? "Saving..." : "Save & Exit"}
                        </Button>
                    </div>

                    <div className="flex flex-col gap-3">
                        <Label className="text-xs text-muted-foreground">Push Further</Label>
                        <Input
                            aria-label="New Target"
                            type="number"
                            min={200}
                            max={9999}
                            step={100}
                            value={newTarget}
                            onChange={(event) => setNewTarget(Number(event.target.value))}
                            className="h-9 text-sm font-mono"
                        />
                        <Button className="w-full font-medium gap-2" onClick={() => onContinue(newTarget)}>
                            <span>Continue</span>
                            <ChevronRight className="w-4 h-4" />
                        </Button>
                    </div>
                </CardFooter>
            </Card>
        </div>
    )
}
