"use client"

import { useState } from "react"
import { Slider } from "@/components/ui/slider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Brain, Save, Play, Square, Loader2 } from "lucide-react"
import type { TrainingDiagnostics, TrainingHubConfig } from "@/core/types"
import { toast } from "sonner"

interface TrainingSidebarProps {
    creatureId: string
    config: TrainingHubConfig
    onChangeConfig: (config: TrainingHubConfig) => void
    isRunning: boolean
    isPaused: boolean
    generation: number
    progress: number
    bestFitness: number
    onToggleStart: () => void
    onReset: () => void
    onSaveProgress: (name: string) => Promise<void>
    hasBestGenome: boolean
    diagnostics: TrainingDiagnostics
    engineError: string | null
    pausePending: boolean
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
    onSaveProgress,
    hasBestGenome,
    diagnostics,
    engineError,
    pausePending,
}: TrainingSidebarProps) {
    const [saving, setSaving] = useState(false)
    const [runName, setRunName] = useState("")

    const handleSave = async () => {
        if (!hasBestGenome) return
        setSaving(true)
        try {
            await onSaveProgress(runName)
            toast.success("Progress saved successfully.")
        } catch (error: any) {
            toast.error(`Error saving progress: ${error.message}`)
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

                <div className="grid grid-cols-2 gap-2 rounded-lg border border-border/70 bg-muted/40 p-2 text-[11px]">
                    <div>
                        <div className="text-muted-foreground">Engine</div>
                        <div className="truncate font-mono font-medium">{diagnostics.backend}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Throughput</div>
                        <div className="font-mono font-medium">{diagnostics.generationsPerSecond.toFixed(2)} gen/s</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Workers</div>
                        <div className="font-mono font-medium">{diagnostics.workerCount}</div>
                    </div>
                    <div>
                        <div className="text-muted-foreground">Memory</div>
                        <div className="font-mono font-medium">{(diagnostics.memoryBytes / 1048576).toFixed(1)} MB</div>
                    </div>
                    {process.env.NODE_ENV === "development" ? (
                        <>
                            <div>
                                <div className="text-muted-foreground">Simulation</div>
                                <div className="font-mono">{diagnostics.stageTimings.simulationMs.toFixed(1)} ms</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">Transition</div>
                                <div className="font-mono">
                                    {(diagnostics.stageTimings.fitnessMs + diagnostics.stageTimings.evolutionMs + diagnostics.stageTimings.resetMs).toFixed(1)} ms
                                </div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">Snapshots dropped</div>
                                <div className="font-mono">{diagnostics.droppedSnapshots}</div>
                            </div>
                            <div>
                                <div className="text-muted-foreground">Pause ack</div>
                                <div className="font-mono">{pausePending ? "pending" : "ready"}</div>
                            </div>
                        </>
                    ) : null}
                </div>

                {engineError ? (
                    <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                        {engineError}
                    </p>
                ) : null}

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

                <div className="space-y-2">
                    <Label htmlFor="training-backend">Compute Backend</Label>
                    <select
                        id="training-backend"
                        disabled={isRunning}
                        value={config.backend ?? "auto"}
                        onChange={(event) => onChangeConfig({
                            ...config,
                            backend: event.target.value as NonNullable<TrainingHubConfig["backend"]>,
                        })}
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <option value="auto">Auto</option>
                        <option value="webgpu">WebGPU</option>
                        <option value="wasm-simd">WASM SIMD</option>
                        <option value="wasm-scalar">WASM Scalar</option>
                        <option value="legacy">Legacy Benchmark</option>
                    </select>
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
                <Label>Save Current Progress</Label>
                <Input
                    placeholder={`Run, Gen ${generation > 0 ? generation : 'N'}`}
                    value={runName}
                    onChange={e => setRunName(e.target.value)}
                    className="h-8 text-sm"
                />
                <Button
                    variant="secondary"
                    className="w-full text-sm"
                    disabled={!hasBestGenome || saving || isRunning}
                    onClick={handleSave}
                >
                    {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {saving ? "Saving..." : "Save Current Progress"}
                </Button>
            </div>
        </div>
    )
}
