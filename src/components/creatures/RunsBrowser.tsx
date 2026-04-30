"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Trophy, History, Play, Trash2, ArrowUpDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
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
import { getTrainingSessions, deleteTrainingSession } from "@/app/actions/sessions"
import { toast } from "sonner"

interface RunsBrowserProps {
    creatureId: string
    creatureName: string
    open: boolean
    onOpenChange: (open: boolean) => void
}

type SortOption = "fitness" | "generations" | "efficiency" | "newest"

export function RunsBrowser({ creatureId, creatureName, open, onOpenChange }: RunsBrowserProps) {
    const router = useRouter()
    const [sessions, setSessions] = useState<any[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [sortBy, setSortBy] = useState<SortOption>("fitness")
    const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        if (open) {
            loadSessions()
        }
    }, [open, creatureId])

    const loadSessions = async () => {
        setIsLoading(true)
        try {
            const data = await getTrainingSessions(creatureId)
            setSessions(data)
        } catch (error) {
            toast.error("Failed to load training runs.")
        } finally {
            setIsLoading(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteTarget) return
        setIsDeleting(true)
        try {
            await deleteTrainingSession(deleteTarget)
            setSessions((prev) => prev.filter((s) => s.id !== deleteTarget))
            toast.success("Run deleted.")
        } catch (error) {
            toast.error("Failed to delete run.")
        } finally {
            setIsDeleting(false)
            setDeleteTarget(null)
        }
    }

    const sortedSessions = [...sessions].sort((a, b) => {
        switch (sortBy) {
            case "fitness":
                return b.bestFitness - a.bestFitness
            case "newest":
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            case "generations":
                // Push non-reached runs to the bottom
                if (a.reachedTarget && !b.reachedTarget) return -1
                if (!a.reachedTarget && b.reachedTarget) return 1
                return a.generation - b.generation
            case "efficiency":
                // Score = (Fitness / Generation) * (TargetDistance / 1000)
                const effA = (a.bestFitness / Math.max(1, a.generation)) * (a.targetDistance / 1000)
                const effB = (b.bestFitness / Math.max(1, b.generation)) * (b.targetDistance / 1000)
                return effB - effA
            default:
                return 0
        }
    })

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-[400px] sm:w-[540px] flex flex-col p-0 bg-card border-border">
                <div className="p-6 pb-4 border-b border-border shrink-0">
                    <SheetHeader>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                                <History className="w-4 h-4 text-primary" />
                            </div>
                            <SheetTitle>Training Runs</SheetTitle>
                        </div>
                        <SheetDescription>
                            Saved sessions for <span className="font-semibold text-foreground">{creatureName}</span>
                        </SheetDescription>
                    </SheetHeader>

                    <div className="mt-6 flex items-center justify-between">
                        <div className="text-sm font-medium text-muted-foreground">
                            {sessions.length} runs saved
                        </div>
                        <div className="flex items-center gap-2">
                            <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
                            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortOption)}>
                                <SelectTrigger className="w-[180px] h-8 text-xs">
                                    <SelectValue placeholder="Sort by" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="fitness">Best Fitness</SelectItem>
                                    <SelectItem value="newest">Newest First</SelectItem>
                                    <SelectItem value="efficiency">Efficiency Score</SelectItem>
                                    <SelectItem value="generations">Fewest Generations</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground">
                            <Loader2 className="w-6 h-6 animate-spin mb-2" />
                            <p className="text-sm">Loading runs...</p>
                        </div>
                    ) : sortedSessions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground border border-dashed rounded-xl border-border/50 bg-background/50">
                            <History className="w-8 h-8 mb-2 opacity-20" />
                            <p className="text-sm">No saved runs yet.</p>
                            <p className="text-xs mt-1 max-w-[200px] text-center">Start a training simulation and save your progress.</p>
                        </div>
                    ) : (
                        sortedSessions.map((session) => (
                            <div
                                key={session.id}
                                className="group flex flex-col rounded-xl border border-border bg-background p-4 transition-all hover:border-primary/40 shadow-sm"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div>
                                        <h3 className="font-semibold text-sm">
                                            {session.name || `Gen ${session.generation} Backup`}
                                        </h3>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {new Date(session.createdAt).toLocaleDateString()} at {new Date(session.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </p>
                                    </div>
                                    {session.reachedTarget ? (
                                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/10 text-amber-500 text-xs font-semibold border border-amber-500/20">
                                            <Trophy className="w-3.5 h-3.5" />
                                            Target Reached
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted text-muted-foreground text-xs font-semibold border border-border">
                                            <History className="w-3.5 h-3.5" />
                                            In Progress
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-3 gap-2 mb-4 bg-card rounded-lg p-2 border border-border/50 text-center">
                                    <div>
                                        <div className="text-[10px] uppercase text-muted-foreground font-semibold">Generation</div>
                                        <div className="text-sm font-mono font-bold">{session.generation}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase text-muted-foreground font-semibold">Distance</div>
                                        <div className="text-sm font-mono font-bold">{session.targetDistance}</div>
                                    </div>
                                    <div>
                                        <div className="text-[10px] uppercase text-muted-foreground font-semibold">Best Fit</div>
                                        <div className="text-sm font-mono font-bold text-primary">{Math.round(session.bestFitness)}</div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 mt-auto">
                                    <Button
                                        className="flex-1 h-8 text-xs font-bold"
                                        onClick={() => router.push(`/dashboard/creatures/${creatureId}/train?session=${session.id}`)}
                                    >
                                        <Play className="w-3.5 h-3.5 mr-1.5 fill-current" />
                                        Load & Continue
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                                        onClick={() => setDeleteTarget(session.id)}
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </Button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </SheetContent>

            <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Training Run?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete this training session. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {isDeleting ? "Deleting..." : "Delete"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Sheet>
    )
}
