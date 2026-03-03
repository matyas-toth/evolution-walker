/**
 * Editor toolbar with tool selection buttons and keyboard shortcuts.
 * @module components/editor/EditorToolbar
 */

"use client"

import { useEffect } from "react"
import { MousePointer2, Circle, Minus, Zap, Trash2, Undo2, Redo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Separator } from "@/components/ui/separator"
import type { EditorTool } from "@/hooks/useEditorState"
import { cn } from "@/lib/utils"

interface EditorToolbarProps {
    tool: EditorTool
    onToolChange: (tool: EditorTool) => void
    onUndo: () => void
    onRedo: () => void
    canUndo: boolean
    canRedo: boolean
}

const tools: { id: EditorTool; label: string; icon: React.ElementType; shortcut: string }[] = [
    { id: "select", label: "Select & Move", icon: MousePointer2, shortcut: "V" },
    { id: "particle", label: "Add Particle", icon: Circle, shortcut: "P" },
    { id: "constraint", label: "Add Constraint", icon: Minus, shortcut: "C" },
    { id: "muscle", label: "Add Muscle", icon: Zap, shortcut: "M" },
    { id: "delete", label: "Delete", icon: Trash2, shortcut: "X" },
]

export function EditorToolbar({ tool, onToolChange, onUndo, onRedo, canUndo, canRedo }: EditorToolbarProps) {
    useEffect(() => {
        function handleKey(e: KeyboardEvent) {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

            if ((e.ctrlKey || e.metaKey) && e.key === "z") {
                e.preventDefault()
                if (e.shiftKey) onRedo()
                else onUndo()
                return
            }

            const match = tools.find((t) => t.shortcut.toLowerCase() === e.key.toLowerCase())
            if (match) onToolChange(match.id)
        }
        window.addEventListener("keydown", handleKey)
        return () => window.removeEventListener("keydown", handleKey)
    }, [onToolChange, onUndo, onRedo])

    return (
        <div className="flex flex-col items-center gap-1 p-2 bg-card border border-border rounded-xl">
            <TooltipProvider delayDuration={200}>
                {tools.map((t) => {
                    const Icon = t.icon
                    const active = tool === t.id
                    return (
                        <Tooltip key={t.id}>
                            <TooltipTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className={cn(
                                        "h-9 w-9 rounded-lg",
                                        active && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary"
                                    )}
                                    onClick={() => onToolChange(t.id)}
                                >
                                    <Icon className="h-4 w-4" />
                                </Button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="flex items-center gap-2">
                                {t.label}
                                <kbd className="ml-1 text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                                    {t.shortcut}
                                </kbd>
                            </TooltipContent>
                        </Tooltip>
                    )
                })}

                <Separator className="my-1 w-6" />

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={onUndo} disabled={!canUndo}>
                            <Undo2 className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Undo <kbd className="ml-1 text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">⌘Z</kbd></TooltipContent>
                </Tooltip>

                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-lg" onClick={onRedo} disabled={!canRedo}>
                            <Redo2 className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">Redo <kbd className="ml-1 text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded text-muted-foreground">⌘⇧Z</kbd></TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
    )
}
