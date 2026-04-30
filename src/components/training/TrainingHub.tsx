"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEvolution, type UseEvolutionProps } from "@/hooks/useEvolution"
import { useReplay } from "@/hooks/useReplay"
import { TrainingSidebar } from "./TrainingSidebar"
import { SimulationCanvas } from "./SimulationCanvas"
import { FitnessChart } from "./FitnessChart"
import { ReplayOverlay } from "./ReplayOverlay"
import { saveTrainingSession } from "@/app/actions/sessions"
import type { Topology, TrainingHubConfig, ReplayPhase, Creature, Genome } from "@/core/types"

interface SerializedSession {
    id: string
    config: TrainingHubConfig
    population: Genome[]
    bestGenome: Genome
    generation: number
}

interface TrainingHubProps {
    creatureId: string
    creatureName: string
    topology: Topology
    /** When provided, the hub restores state from this saved session. */
    initialSession?: SerializedSession
}

/** Derives initial config state from an optional saved session or sensible defaults. */
function resolveInitialConfig(session?: SerializedSession): TrainingHubConfig {
    if (session?.config) return session.config
    return {
        populationSize: 500,
        generationDuration: 10,
        mutationRate: 0.12,
        mutationStrength: 0.42,
        elitismCount: 1,
        parentsTopPercent: 0.2,
        targetDistance: 1400,
        backgroundMode: false,
        simulationSpeed: 1,
    }
}

export function TrainingHub({ creatureId, creatureName, topology, initialSession }: TrainingHubProps) {
    const router = useRouter()
    const [config, setConfig] = useState<TrainingHubConfig>(resolveInitialConfig(initialSession))
    const [replayPhase, setReplayPhase] = useState<ReplayPhase>({ type: "none" })
    const [isSaving, setIsSaving] = useState(false)

    const { replayCreature, replayProgress, startReplay, stopReplay } = useReplay(topology)

    const handleTargetReached = useCallback((winner: Creature) => {
        setReplayPhase({ type: "active", genome: winner.genome, generation: winner.genome.generation })
        startReplay(winner.genome)
    }, [startReplay])

    const evolutionProps: UseEvolutionProps = {
        ...config,
        topology,
        initialPopulation: initialSession?.population,
        initialGeneration: initialSession?.generation,
        onTargetReached: handleTargetReached,
    }

    const {
        phase,
        generation,
        creatures,
        progress,
        fitnessHistory,
        bestCreatureEver,
        currentGenomes,
        start,
        stop,
        reset,
    } = useEvolution(evolutionProps)

    const isRunning = phase === "running" || phase === "evaluating" || phase === "evolving"
    const isPaused = phase === "paused"
    const isReplayActive = replayPhase.type === "active"

    const handleToggleStart = () => {
        if (isRunning) stop()
        else start()
    }

    const handleSaveAndExit = useCallback(async (runName: string) => {
        if (replayPhase.type !== "active") return
        setIsSaving(true)
        try {
            await saveTrainingSession({
                creatureId,
                name: runName || `Gen ${generation} — Target Reached`,
                config,
                population: currentGenomes,
                bestGenome: replayPhase.genome,
                bestFitness: bestCreatureEver?.fitness?.total ?? 0,
                generation,
                reachedTarget: true,
            })
            stopReplay()
            router.push(`/dashboard/creatures`)
        } catch (err) {
            console.error("Failed to save session:", err)
        } finally {
            setIsSaving(false)
        }
    }, [replayPhase, creatureId, config, currentGenomes, generation, bestCreatureEver, stopReplay, router])

    const handleContinue = useCallback((newTargetDistance: number) => {
        stopReplay()
        setReplayPhase({ type: "none" })
        setConfig((prev) => ({ ...prev, targetDistance: newTargetDistance }))
        // Reset the targetReachedFired flag by resetting + starting fresh
        reset()
        // Small delay so config state propagates before start
        setTimeout(() => start(), 50)
    }, [stopReplay, reset, start])

    const handleSaveProgress = useCallback(async (runName: string) => {
        if (!bestCreatureEver) return
        await saveTrainingSession({
            creatureId,
            name: runName || `Gen ${generation}`,
            config,
            population: currentGenomes,
            bestGenome: bestCreatureEver.genome,
            bestFitness: bestCreatureEver.fitness?.total ?? 0,
            generation,
            reachedTarget: false,
        })
    }, [creatureId, config, currentGenomes, generation, bestCreatureEver])

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-background">
            <div className="flex items-center justify-between h-14 px-4 border-b border-border bg-card shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push(`/dashboard/creatures/${creatureId}/edit`)}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex flex-col">
                        <h1 className="text-sm font-semibold">{creatureName}</h1>
                        <span className="text-xs text-muted-foreground">
                            Training Simulation
                            {initialSession && " - Resumed Session"}
                        </span>
                    </div>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden relative">
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="flex-1 relative">
                        {isRunning || isPaused ? (
                            <SimulationCanvas
                                creatures={creatures}
                                groundY={600}
                                targetZone={{ x: config.targetDistance, y: 500, width: 100, height: 80 }}
                                showCount={5}
                                dimmed={isReplayActive}
                            />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-muted/10">
                                <div className="text-center space-y-2">
                                    <p className="font-medium text-foreground">Simulation Paused</p>
                                    <p className="text-sm">Configure parameters on the right and click Start Evolution.</p>
                                </div>
                            </div>
                        )}

                        {/* COD-style replay overlay */}
                        {isReplayActive && replayPhase.type === "active" && (
                            <ReplayOverlay
                                generation={replayPhase.generation}
                                replayCreature={replayCreature}
                                replayProgress={replayProgress}
                                currentTargetDistance={config.targetDistance}
                                isSaving={isSaving}
                                onSaveAndExit={handleSaveAndExit}
                                onContinue={handleContinue}
                            />
                        )}
                    </div>

                    <div className="h-48 shrink-0 bg-card z-10 w-full flex flex-col">
                        <FitnessChart data={fitnessHistory} />
                    </div>
                </div>

                <TrainingSidebar
                    creatureId={creatureId}
                    config={config}
                    onChangeConfig={setConfig}
                    isRunning={isRunning}
                    isPaused={isPaused}
                    generation={generation}
                    progress={progress}
                    bestFitness={bestCreatureEver?.fitness?.total ?? 0}
                    onToggleStart={handleToggleStart}
                    onReset={reset}
                    onSaveProgress={handleSaveProgress}
                    hasBestGenome={!!bestCreatureEver}
                />
            </div>
        </div>
    )
}
