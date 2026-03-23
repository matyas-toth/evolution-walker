"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEvolution, type UseEvolutionProps } from "@/hooks/useEvolution"
import { TrainingSidebar } from "./TrainingSidebar"
import { SimulationCanvas } from "./SimulationCanvas"
import { FitnessChart } from "./FitnessChart"
import type { Topology } from "@/core/types"

interface TrainingHubProps {
    creatureId: string
    creatureName: string
    topology: Topology
}

export function TrainingHub({ creatureId, creatureName, topology }: TrainingHubProps) {
    const router = useRouter()

    const [config, setConfig] = useState<Omit<UseEvolutionProps, "topology"> & { simulationSpeed: number }>({
        populationSize: 500,
        generationDuration: 10,
        mutationRate: 0.12,
        mutationStrength: 0.42,
        elitismCount: 1,
        parentsTopPercent: 0.2,
        targetDistance: 1400,
        backgroundMode: false,
        simulationSpeed: 1,
    })

    const {
        phase,
        generation,
        creatures,
        progress,
        fitnessHistory,
        bestCreatureEver,
        start,
        stop,
        reset
    } = useEvolution({
        ...config,
        topology,
    })

    const isRunning = phase === "running" || phase === "evaluating" || phase === "evolving"
    const isPaused = phase === "paused"

    const handleToggleStart = () => {
        if (isRunning) stop()
        else start()
    }

    return (
        <div className="flex flex-col h-screen overflow-hidden bg-background">
            <div className="flex items-center justify-between h-14 px-4 border-b border-border bg-card shrink-0 shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push(`/dashboard/creatures/${creatureId}/edit`)}>
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <div className="flex flex-col">
                        <h1 className="text-sm font-semibold">{creatureName}</h1>
                        <span className="text-xs text-muted-foreground">Training Simulation</span>
                    </div>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden relative">
                <div className="flex-1 flex flex-col min-w-0">
                    <div className="flex-1 relative">
                        {isRunning ? (
                            <SimulationCanvas
                                creatures={creatures}
                                groundY={600}
                                targetZone={{ x: config.targetDistance, y: 500, width: 100, height: 80 }}
                                showCount={5}
                            />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground bg-muted/10">
                                <div className="text-center space-y-2">
                                    <p className="font-medium text-foreground">Simulation Paused</p>
                                    <p className="text-sm">Configure parameters on the right and click Start Evolution.</p>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* The Chart anchors the bottom of the canvas view */}
                    <div className="h-48 shrink-0 bg-card z-10 w-full flex flex-col">
                        <FitnessChart data={fitnessHistory} />
                    </div>
                </div>

                <TrainingSidebar
                    creatureId={creatureId}
                    config={config}
                    onChangeConfig={setConfig as any}
                    isRunning={isRunning}
                    isPaused={isPaused}
                    generation={generation}
                    progress={progress}
                    bestFitness={bestCreatureEver?.fitness?.total ?? 0}
                    onToggleStart={handleToggleStart}
                    onReset={reset}
                    bestGenome={bestCreatureEver?.genome}
                />
            </div>
        </div>
    )
}
