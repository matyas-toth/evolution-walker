"use client"

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createCreatureFromTopology } from "@/core/simulation/creature"
import { TrainingEngineClient } from "@/core/training/TrainingEngineClient"
import { resolveTrainingEngineConfig } from "@/core/training/types"
import type {
    Creature,
    Genome,
    PackedTrainingReplay,
    Topology,
    TrainingDiagnostics,
    TrainingEngineState,
    TrainingEvent,
    TrainingHubConfig,
} from "@/core/types"

export interface UseEvolutionProps extends TrainingHubConfig {
    topology: Topology | null
    groundY?: number
    initialPopulation?: Genome[]
    initialGeneration?: number
    onTargetReached?: (winner: Creature) => void
}

export type EvolutionPhase = "idle" | "running" | "evaluating" | "evolving" | "paused"

export interface FitnessDataPoint {
    generation: number
    bestFitness: number
    averageFitness: number
}

const EMPTY_DIAGNOSTICS: TrainingDiagnostics = {
    backend: "initializing",
    workerCount: 0,
    generationsPerSecond: 0,
    stageTimings: {
        initializeMs: 0,
        simulationMs: 0,
        fitnessMs: 0,
        evolutionMs: 0,
        resetMs: 0,
        transferMs: 0,
        totalGenerationMs: 0,
    },
    droppedSnapshots: 0,
    memoryBytes: 0,
}

/** Keeps chart rendering bounded while retaining recent and long-term trend information. */
function appendFitnessPoint(history: FitnessDataPoint[], point: FitnessDataPoint): FitnessDataPoint[] {
    if (history.length < 2000) return [...history, point]
    const decimated: FitnessDataPoint[] = []
    for (let index = 0; index < history.length; index += 2) decimated.push(history[index])
    decimated.push(point)
    return decimated
}

/** React adapter for the worker-owned training engine. */
export function useEvolution(props: UseEvolutionProps) {
    const {
        topology,
        groundY = 600,
        initialPopulation,
        initialGeneration,
        onTargetReached,
    } = props
    const clientRef = useRef<TrainingEngineClient | null>(null)
    const renderCreaturesRef = useRef<Creature[]>([])
    const callbackRef = useRef(onTargetReached)
    callbackRef.current = onTargetReached

    const [phase, setPhase] = useState<EvolutionPhase>("idle")
    const [generation, setGeneration] = useState(initialGeneration ?? 0)
    const [creatures, setCreatures] = useState<Creature[]>([])
    const [fitnessHistory, setFitnessHistory] = useState<FitnessDataPoint[]>([])
    const [bestCreatureEver, setBestCreatureEver] = useState<Creature | null>(null)
    const [progress, setProgress] = useState(0)
    const [diagnostics, setDiagnostics] = useState<TrainingDiagnostics>(EMPTY_DIAGNOSTICS)
    const [error, setError] = useState<string | null>(null)
    const [pausePending, setPausePending] = useState(false)

    const engineConfig = useMemo(() => resolveTrainingEngineConfig(props), [
        props.populationSize,
        props.generationDuration,
        props.mutationRate,
        props.mutationStrength,
        props.elitismCount,
        props.parentsTopPercent,
        props.targetDistance,
        props.backgroundMode,
        props.simulationSpeed,
        props.backend,
        props.seed,
        props.workerCount,
        props.snapshotHz,
    ])

    const applyRenderSnapshot = useCallback((event: Extract<TrainingEvent, { type: "snapshot" | "ready" | "paused" }>) => {
        if (!topology || !event.snapshot.render) return
        const render = event.snapshot.render
        if (renderCreaturesRef.current.length !== render.creatureCount) {
            renderCreaturesRef.current = Array.from({ length: render.creatureCount }, () =>
                createCreatureFromTopology(topology, undefined, { x: 100, y: groundY - 30 }),
            )
        }
        for (let creatureIndex = 0; creatureIndex < render.creatureCount; creatureIndex++) {
            const creature = renderCreaturesRef.current[creatureIndex]
            for (let particleIndex = 0; particleIndex < render.particleCount; particleIndex++) {
                const source = (creatureIndex * render.particleCount + particleIndex) * 2
                const particle = creature.particles[particleIndex]
                particle.oldPos.x = particle.pos.x
                particle.oldPos.y = particle.pos.y
                particle.pos.x = render.positions[source]
                particle.pos.y = render.positions[source + 1]
            }
            creature.currentPos.x = render.centers[creatureIndex * 2]
            creature.currentPos.y = render.centers[creatureIndex * 2 + 1]
        }
        setCreatures([...renderCreaturesRef.current])
    }, [groundY, topology])

    useEffect(() => {
        if (!topology || typeof window === "undefined") return
        const client = new TrainingEngineClient()
        clientRef.current = client
        const unsubscribe = client.subscribe((event) => {
            if (event.type === "error") {
                setError(event.message)
                return
            }
            if (event.type === "generation") {
                setFitnessHistory((history) => appendFitnessPoint(history, {
                    generation: event.generation,
                    bestFitness: event.bestFitness,
                    averageFitness: event.averageFitness,
                }))
                setBestCreatureEver((previous) => {
                    if (previous && (previous.fitness?.total ?? Number.NEGATIVE_INFINITY) >= event.bestFitness) return previous
                    const best = createCreatureFromTopology(topology, event.bestGenome, { x: 100, y: groundY - 30 })
                    best.fitness.total = event.bestFitness
                    return best
                })
                return
            }
            if (event.type === "targetReached") {
                setPhase("paused")
                setGeneration(event.snapshot.generation)
                setProgress(event.snapshot.progress)
                setDiagnostics(event.snapshot.diagnostics)
                setPausePending(false)
                const winner = createCreatureFromTopology(topology, event.genome, { x: 100, y: groundY - 30 })
                callbackRef.current?.(winner)
                return
            }
            if (event.type === "backendChanged" || event.type === "sessionExported"
                || event.type === "replayReady" || event.type === "replayFailed") return
            const snapshot = event.snapshot
            if (event.type === "paused") setPausePending(false)
            startTransition(() => {
                setPhase(snapshot.phase)
                setGeneration(snapshot.generation)
                setProgress(snapshot.progress)
                setDiagnostics(snapshot.diagnostics)
                applyRenderSnapshot(event)
            })
        })
        client.initialize(topology, engineConfig, initialPopulation, initialGeneration)
        return () => {
            unsubscribe()
            client.dispose()
            if (clientRef.current === client) clientRef.current = null
        }
    }, [applyRenderSnapshot, initialGeneration, initialPopulation, topology])

    useEffect(() => {
        clientRef.current?.updateConfig(engineConfig)
    }, [engineConfig])

    const start = useCallback(() => {
        setError(null)
        setPausePending(false)
        setPhase("running")
        clientRef.current?.start()
    }, [])

    const stop = useCallback(() => {
        setPausePending(true)
        setPhase("paused")
        clientRef.current?.pause()
    }, [])

    const reset = useCallback(() => {
        setPhase("idle")
        setGeneration(0)
        setProgress(0)
        setCreatures([])
        setFitnessHistory([])
        setBestCreatureEver(null)
        setError(null)
        setPausePending(false)
        renderCreaturesRef.current = []
        clientRef.current?.reset()
    }, [])

    const exportSession = useCallback(async (): Promise<TrainingEngineState> => {
        const client = clientRef.current
        if (!client) throw new Error("Training engine is not ready")
        return client.exportSession()
    }, [])

    const requestReplay = useCallback(async (genome: Genome): Promise<PackedTrainingReplay> => {
        const client = clientRef.current
        if (!client) throw new Error("Training engine is not ready")
        return client.requestReplay(genome)
    }, [])

    return {
        phase,
        generation,
        creatures,
        progress,
        bestCreatureEver,
        fitnessHistory,
        diagnostics,
        error,
        pausePending,
        start,
        stop,
        reset,
        exportSession,
        requestReplay,
    }
}
