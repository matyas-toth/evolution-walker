"use client"

import { useState } from "react"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Brain, Save, Play, Square, Loader2 } from "lucide-react"
import type { UseEvolutionProps } from "@/hooks/useEvolution"
import { saveGenome } from "@/app/actions/genomes"
import { useRouter } from "next/navigation"

interface TrainingSidebarProps {
    creatureId: string
    config: Omit<UseEvolutionProps, "topology"> & { simulationSpeed: number }
    onChangeConfig: (config: Omit<UseEvolutionProps, "topology"> & { simulationSpeed: number }) => void
    isRunning: boolean
    isPaused: boolean
    generation: number
    progress: number
    bestFitness: number
    onToggleStart: () => void
    onReset: () => void
    bestGenome: any // the serialized genome of the best creature
}

export function TrainingSidebar({
    creatureId,
    config,
    onChangeConfig,
    isRunning,
    isPaused,
    generation,
    progress,
    bestFitness,
    onToggleStart,
    onReset,
    bestGenome
}: TrainingSidebarProps) {
    const router = useRouter()
    const [saving, setSaving] = useState(false)
    const [runName, setRunName] = useState("")

    const handleSave = async () => {
        if (!bestGenome) return
        setSaving(true)
        try {
            await saveGenome(creatureId, bestGenome, bestFitness, false, runName || `Generation ${generation}`)
            alert("The genome has been saved successfully.")
            router.refresh()
        } catch (error: any) {
            alert(`Error saving genome: ${error.message}`)
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="w-72 border-l border-border bg-card h-full flex flex-col hide-scrollbar overflow-y-auto">
            <div className="p-4 border-b border-border space-y-4 shrink-0">
                <div className="flex items-center gap-2">
                    <Brain className="w-5 h-5 text-primary" />
                    <h2 className="font-semibold">Training Hub</h2>
                </div>

                <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="bg-muted p-2 rounded-lg text-center">
                        <div className="text-muted-foreground mb-1">Generation</div>
                        <div className="font-mono text-lg font-bold">{generation}</div>
                    </div>
                    <div className="bg-muted p-2 rounded-lg text-center">
                        <div className="text-muted-foreground mb-1">Max Fitness</div>
                        <div className="font-mono text-lg font-bold text-primary">{bestFitness.toFixed(0)}</div>
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Progress</span>
                        <span>{progress}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                    </div>
                </div>

                <div className="flex gap-2">
                    <Button
                        variant={isRunning ? "destructive" : "default"}
                        className="flex-1 flex items-center justify-center gap-2"
                        onClick={onToggleStart}
                    >
                        {isRunning ? <><Square className="w-4 h-4 fill-current" /> Pause Evolution</> :
                            isPaused ? <><Play className="w-4 h-4 fill-current" /> Resume</> :
                                <><Play className="w-4 h-4 fill-current" /> Start Evolution</>}
                    </Button>
                    {(isRunning || isPaused || generation > 0) && (
                        <Button variant="outline" onClick={onReset} title="Reset Simulation">
                            Reset
                        </Button>
                    )}
                </div>
            </div>

            <div className="p-4 space-y-6 flex-1">
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <Label>Background Mode</Label>
                        <Switch
                            disabled={isRunning}
                            checked={config.backgroundMode}
                            onCheckedChange={(c) => onChangeConfig({ ...config, backgroundMode: c })}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Disable 60fps rendering to train at maximum CPU speed. Only recommended for large populations.
                    </p>
                </div>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label>Population Size: {config.populationSize}</Label>
                        <Slider
                            disabled={isRunning}
                            min={10} max={2000} step={10}
                            value={[config.populationSize]}
                            onValueChange={([v]) => onChangeConfig({ ...config, populationSize: v })}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Simulation Speed: {config.simulationSpeed}x</Label>
                        <Slider
                            disabled={config.backgroundMode}
                            min={0.1} max={100} step={0.1}
                            value={[config.simulationSpeed]}
                            onValueChange={([v]) => onChangeConfig({ ...config, simulationSpeed: v })}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Generation Duration (s): {config.generationDuration}</Label>
                        <Slider
                            disabled={isRunning}
                            min={3} max={30} step={1}
                            value={[config.generationDuration]}
                            onValueChange={([v]) => onChangeConfig({ ...config, generationDuration: v })}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Mutation Rate: {(config.mutationRate * 100).toFixed(0)}%</Label>
                        <Slider
                            disabled={isRunning}
                            min={0.01} max={0.5} step={0.01}
                            value={[config.mutationRate]}
                            onValueChange={([v]) => onChangeConfig({ ...config, mutationRate: v })}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Mutation Strength: {config.mutationStrength.toFixed(2)}</Label>
                        <Slider
                            disabled={isRunning}
                            min={0.05} max={2.0} step={0.05}
                            value={[config.mutationStrength]}
                            onValueChange={([v]) => onChangeConfig({ ...config, mutationStrength: v })}
                        />
                    </div>

                    <div className="space-y-2">
                        <Label>Target Distance: {config.targetDistance}</Label>
                        <Slider
                            disabled={isRunning}
                            min={200} max={5000} step={100}
                            value={[config.targetDistance]}
                            onValueChange={([v]) => onChangeConfig({ ...config, targetDistance: v })}
                        />
                    </div>
                </div>
            </div>

            <div className="p-4 border-t border-border mt-auto shrink-0 space-y-3 bg-muted/30">
                <Label>Save Custom Genome</Label>
                <Input
                    placeholder="E.g. Gen 50 Fast Sprinter"
                    value={runName}
                    onChange={e => setRunName(e.target.value)}
                    className="h-8 text-sm"
                />
                <Button
                    variant="secondary"
                    className="w-full text-sm"
                    disabled={!bestGenome || saving || isRunning}
                    onClick={handleSave}
                >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {saving ? "Saving..." : "Save Best Genome"}
                </Button>
            </div>
        </div>
    )
}
