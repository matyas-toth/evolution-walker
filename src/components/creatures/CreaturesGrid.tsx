/**
 * Creatures grid component with create/delete actions and topology preview cards.
 * Client component managing creature list state and interactions.
 * @module components/creatures/CreaturesGrid
 */

"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Plus, Pencil, Trash2, Dna } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import type { Topology } from "@/core/types"

interface CreatureData {
    id: string
    name: string
    topology: Topology
    createdAt: string
    updatedAt: string
}

interface CreaturesGridProps {
    creatures: CreatureData[]
}

function TopologyPreview({ topology }: { topology: Topology }) {
    const canvasRef = useRef<HTMLCanvasElement>(null)

    const draw = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext("2d")
        if (!ctx) return

        const dpr = window.devicePixelRatio || 1
        canvas.width = canvas.offsetWidth * dpr
        canvas.height = canvas.offsetHeight * dpr
        ctx.scale(dpr, dpr)
        ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)

        const w = canvas.offsetWidth
        const h = canvas.offsetHeight

        if (topology.particles.length === 0) {
            ctx.fillStyle = "oklch(0.60 0.01 260)"
            ctx.font = "11px var(--font-geist-sans), sans-serif"
            ctx.textAlign = "center"
            ctx.fillText("Empty", w / 2, h / 2 + 4)
            return
        }

        const xs = topology.particles.map((p) => p.initialPos.x)
        const ys = topology.particles.map((p) => p.initialPos.y)
        const minX = Math.min(...xs), maxX = Math.max(...xs)
        const minY = Math.min(...ys), maxY = Math.max(...ys)
        const rangeX = maxX - minX || 1
        const rangeY = maxY - minY || 1
        const padding = 20
        const scale = Math.min((w - padding * 2) / rangeX, (h - padding * 2) / rangeY)
        const cx = w / 2, cy = h / 2
        const offsetX = (minX + maxX) / 2, offsetY = (minY + maxY) / 2

        const toScreen = (x: number, y: number) => ({
            sx: cx + (x - offsetX) * scale,
            sy: cy + (y - offsetY) * scale,
        })

        const particleMap = new Map(topology.particles.map((p) => [p.id, p]))

        ctx.lineWidth = 1.5
        ctx.lineCap = "round"
        for (const c of topology.constraints) {
            const p1 = particleMap.get(c.p1Id)
            const p2 = particleMap.get(c.p2Id)
            if (!p1 || !p2) continue
            const s1 = toScreen(p1.initialPos.x, p1.initialPos.y)
            const s2 = toScreen(p2.initialPos.x, p2.initialPos.y)
            ctx.strokeStyle = "oklch(0.50 0.01 260)"
            ctx.beginPath()
            ctx.moveTo(s1.sx, s1.sy)
            ctx.lineTo(s2.sx, s2.sy)
            ctx.stroke()
        }

        ctx.lineWidth = 2.5
        for (const m of topology.muscles) {
            const p1 = particleMap.get(m.p1Id)
            const p2 = particleMap.get(m.p2Id)
            if (!p1 || !p2) continue
            const s1 = toScreen(p1.initialPos.x, p1.initialPos.y)
            const s2 = toScreen(p2.initialPos.x, p2.initialPos.y)
            ctx.strokeStyle = "oklch(0.72 0.17 162 / 0.7)"
            ctx.beginPath()
            ctx.moveTo(s1.sx, s1.sy)
            ctx.lineTo(s2.sx, s2.sy)
            ctx.stroke()
        }

        for (const p of topology.particles) {
            const s = toScreen(p.initialPos.x, p.initialPos.y)
            const r = Math.max(3, p.radius * scale * 0.15)
            ctx.fillStyle = "oklch(0.85 0.02 260)"
            ctx.beginPath()
            ctx.arc(s.sx, s.sy, r, 0, Math.PI * 2)
            ctx.fill()
        }
    }, [topology])

    useEffect(() => { draw() }, [draw])

    return <canvas ref={canvasRef} className="w-full h-full" />
}

export function CreaturesGrid({ creatures: initial }: CreaturesGridProps) {
    const router = useRouter()
    const [creatures, setCreatures] = useState(initial)
    const [createOpen, setCreateOpen] = useState(false)
    const [newName, setNewName] = useState("")
    const [creating, setCreating] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<CreatureData | null>(null)
    const [deleting, setDeleting] = useState(false)

    async function handleCreate() {
        if (!newName.trim()) return
        setCreating(true)
        try {
            const res = await fetch("/api/creatures", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: newName.trim() }),
            })
            if (res.ok) {
                const creature = await res.json()
                setCreateOpen(false)
                setNewName("")
                router.push(`/dashboard/creatures/${creature.id}/edit`)
            }
        } finally {
            setCreating(false)
        }
    }

    async function handleDelete() {
        if (!deleteTarget) return
        setDeleting(true)
        try {
            const res = await fetch(`/api/creatures/${deleteTarget.id}`, { method: "DELETE" })
            if (res.ok) {
                setCreatures((prev) => prev.filter((c) => c.id !== deleteTarget.id))
                setDeleteTarget(null)
                router.refresh()
            }
        } finally {
            setDeleting(false)
        }
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Creatures</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        Design and manage your creature topologies
                    </p>
                </div>
                <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                    <DialogTrigger asChild>
                        <Button size="sm">
                            <Plus className="mr-2 h-4 w-4" />
                            New Creature
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create New Creature</DialogTitle>
                            <DialogDescription>
                                Start with an empty topology. You can design it in the editor.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="flex flex-col gap-2 py-2">
                            <Label htmlFor="creature-name">Name</Label>
                            <Input
                                id="creature-name"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="My Creature"
                                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                                autoFocus
                            />
                        </div>
                        <DialogFooter>
                            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
                            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                                {creating ? "Creating..." : "Create"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {creatures.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 py-16">
                    <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4">
                        <Dna className="h-6 w-6 text-primary" />
                    </div>
                    <h3 className="font-medium text-lg mb-1">No creatures yet</h3>
                    <p className="text-sm text-muted-foreground mb-4">Create your first creature to get started</p>
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        New Creature
                    </Button>
                </div>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {creatures.map((creature) => (
                        <div
                            key={creature.id}
                            className="group relative flex flex-col rounded-xl border border-border bg-card overflow-hidden transition-colors hover:border-primary/30"
                        >
                            <div className="h-40 bg-background/50 p-4">
                                <TopologyPreview topology={creature.topology} />
                            </div>
                            <div className="flex items-center justify-between p-4 border-t border-border">
                                <div className="min-w-0 flex-1">
                                    <h3 className="font-medium text-sm truncate">{creature.name}</h3>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {creature.topology.particles.length} particles · {creature.topology.constraints.length} constraints · {creature.topology.muscles.length} muscles
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8"
                                        onClick={() => router.push(`/dashboard/creatures/${creature.id}/edit`)}
                                    >
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-destructive hover:text-destructive"
                                        onClick={() => setDeleteTarget(creature)}
                                    >
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This creature and its topology will be permanently removed.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={deleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {deleting ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
