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
    LocomotionCurriculumStage,
    LocomotionMetrics,
    QdArchiveExport,
} from "@/core/types"

export interface UseEvolutionProps extends TrainingHubConfig {
    topology: Topology | null
    groundY?: number
    initialPopulation?: Genome[]
    initialGeneration?: number
    initialArchive?: QdArchiveExport
    initialBestMetrics?: LocomotionMetrics
    onTargetReached?: (winner: Creature, metrics: LocomotionMetrics) => void
}

export type EvolutionPhase = "idle" | "running" | "evaluating" | "evolving" | "paused"

export interface FitnessDataPoint {
    generation: number
    bestFitness: number
    averageFitness: number
    taskProgress: number
    locomotionQuality: number
    archiveCoverage: number
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
        initialArchive,
        initialBestMetrics,
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
    const [bestFitness, setBestFitness] = useState(0)
    const [progress, setProgress] = useState(0)
    const [diagnostics, setDiagnostics] = useState<TrainingDiagnostics>(EMPTY_DIAGNOSTICS)
    const [error, setError] = useState<string | null>(null)
    const [pausePending, setPausePending] = useState(false)
    const [bestMetrics, setBestMetrics] = useState<LocomotionMetrics | null>(initialBestMetrics ?? null)
    const [archiveCoverage, setArchiveCoverage] = useState(initialArchive ? initialArchive.elites.length / 960 : 0)
    const [curriculumStage, setCurriculumStage] = useState<LocomotionCurriculumStage>("discovery")

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
        props.fitnessVersion,
        props.controllerVersion,
        props.upgradedFromSessionId,
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
                    taskProgress: event.bestMetrics.progress,
                    locomotionQuality: event.bestMetrics.locomotionQuality,
                    archiveCoverage: event.archiveCoverage * 100,
                }))
                setBestMetrics(event.bestMetrics)
                setBestFitness((current) => Math.max(current, event.bestFitness))
                setArchiveCoverage(event.archiveCoverage)
                setCurriculumStage(event.curriculumStage)
                setBestCreatureEver(() => {
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
                setBestFitness((current) => Math.max(current, event.snapshot.bestFitness))
                setBestMetrics(event.metrics)
                setArchiveCoverage(event.snapshot.archiveCoverage)
                setCurriculumStage(event.snapshot.curriculumStage)
                setPausePending(false)
                const winner = createCreatureFromTopology(topology, event.genome, { x: 100, y: groundY - 30 })
                callbackRef.current?.(winner, event.metrics)
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
                setBestFitness((current) => Math.max(current, snapshot.bestFitness))
                setBestMetrics(snapshot.bestMetrics)
                setArchiveCoverage(snapshot.archiveCoverage)
                setCurriculumStage(snapshot.curriculumStage)
                applyRenderSnapshot(event)
            })
        })
        client.initialize(topology, engineConfig, initialPopulation, initialGeneration, initialArchive, initialBestMetrics)
        return () => {
            unsubscribe()
            client.dispose()
            if (clientRef.current === client) clientRef.current = null
        }
    }, [applyRenderSnapshot, initialArchive, initialBestMetrics, initialGeneration, initialPopulation, topology])

    useEffect(() => {
        clientRef.current?.updateConfig(engineConfig)
    }, [engineConfig])

    const start = useCallback(() => {
        setError(null)
        setPausePending(false)
        setBestMetrics(null)
        setArchiveCoverage(0)
        setCurriculumStage("discovery")
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
        setBestFitness(0)
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
        bestFitness,
        fitnessHistory,
        diagnostics,
        error,
        pausePending,
        bestMetrics,
        archiveCoverage,
        curriculumStage,
        start,
        stop,
        reset,
        exportSession,
        requestReplay,
    }
}
