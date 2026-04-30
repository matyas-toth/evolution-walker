"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { createCreatureFromTopology, calculateCenterOfMass } from "@/core/simulation/creature"
import { createInitialPopulation, calculateFitnessAdvanced, sbxCrossover, EvolutionWorker, type EvolutionConfig, type CreatureData } from "@/core/genetics"
import { stepPhysics, loadPhysicsWasm, isBatchWasmReady, stepPhysicsBatch, checkCreatureTargetZone, checkHeadGroundAndKill } from "@/core/physics"
import type { Creature, Topology } from "@/core/types"

export interface UseEvolutionProps {
    topology: Topology | null
    populationSize: number
    generationDuration: number // seconds
    mutationRate: number
    mutationStrength: number
    elitismCount: number
    parentsTopPercent: number
    targetDistance: number
    groundY?: number
    backgroundMode?: boolean
    simulationSpeed?: number
    /** Seed the first generation with a saved population instead of random init */
    initialPopulation?: Genome[]
    /** Starting generation number when restoring a saved session */
    initialGeneration?: number
    /** Called once when any creature first reaches the target zone */
    onTargetReached?: (winner: Creature) => void
}

export type EvolutionPhase = "idle" | "running" | "evaluating" | "evolving" | "paused"

const FIXED_TIMESTEP = 1 / 60
const GRAVITY = 200
const MUSCLE_STIFFNESS = 0.9
const GROUND_FRICTION = 0.7
const SBX_ETA = 10

export interface FitnessDataPoint {
    generation: number
    bestFitness: number
    averageFitness: number
}

export function useEvolution(props: UseEvolutionProps) {
    const {
        topology,
        populationSize,
        generationDuration,
        mutationRate,
        mutationStrength,
        elitismCount,
        parentsTopPercent,
        targetDistance,
        groundY = 600,
        backgroundMode = false,
        simulationSpeed = 1,
    } = props

    const configRef = useRef(props)
    configRef.current = props

    const TOTAL_GENERATION_STEPS = Math.round(generationDuration / FIXED_TIMESTEP)

    const [phase, setPhase] = useState<EvolutionPhase>("idle")
    const [generation, setGeneration] = useState(0)
    const [creatures, setCreatures] = useState<Creature[]>([])
    const [fitnessHistory, setFitnessHistory] = useState<FitnessDataPoint[]>([])
    const [bestCreatureEver, setBestCreatureEver] = useState<Creature | null>(null)
    const [progress, setProgress] = useState(0)
    const [currentGenomes, setCurrentGenomes] = useState<Genome[]>([])
    const targetReachedFiredRef = useRef(false)

    const creaturesRef = useRef<Creature[]>([])
    const phaseRef = useRef<EvolutionPhase>("idle")
    const generationRef = useRef<number>(0)

    // Physics / Time state
    const animationFrameRef = useRef<number>(0)
    const lastTimeRef = useRef<number>(0)
    const lastUIRenderTimeRef = useRef<number>(0)
    const timeAccumulatorRef = useRef<number>(0)
    const totalStepsRef = useRef<number>(0)

    const evolutionWorkerRef = useRef<EvolutionWorker | null>(null)
    const isWasmReadyRef = useRef(false)



    // Initialize WASM and Worker
    useEffect(() => {
        loadPhysicsWasm().then(() => {
            isWasmReadyRef.current = true
        })

        if (typeof window !== "undefined") {
            evolutionWorkerRef.current = new EvolutionWorker()
            return () => {
                if (evolutionWorkerRef.current) {
                    evolutionWorkerRef.current.terminate()
                    evolutionWorkerRef.current = null
                }
            }
        }
    }, [])

    const start = useCallback(() => {
        if (!topology) return

        if (phaseRef.current === "paused" && creaturesRef.current.length > 0) {
            // Resume
            phaseRef.current = "running"
            setPhase("running")
            lastTimeRef.current = performance.now()
            if (!animationFrameRef.current) {
                animationFrameRef.current = requestAnimationFrame(loop)
            }
            return
        }

        const startingGenomes = props.initialPopulation && props.initialPopulation.length > 0
            ? props.initialPopulation
            : createInitialPopulation(topology, populationSize)

        const startingGeneration = props.initialGeneration ?? 1
        const spawnPos = { x: 100, y: groundY - 30 }

        const initialCreatures = startingGenomes.map((genome) =>
            createCreatureFromTopology(topology, genome, spawnPos)
        )

        creaturesRef.current = initialCreatures
        setCreatures([...initialCreatures])
        setCurrentGenomes(startingGenomes)

        phaseRef.current = "running"
        setPhase("running")

        generationRef.current = startingGeneration
        setGeneration(startingGeneration)

        targetReachedFiredRef.current = false
        timeAccumulatorRef.current = 0
        totalStepsRef.current = 0
        lastTimeRef.current = performance.now()
        setProgress(0)
        setFitnessHistory([])
        setBestCreatureEver(null)

        if (!animationFrameRef.current) {
            animationFrameRef.current = requestAnimationFrame(loop)
        }
    }, [topology, populationSize, groundY])

    const stop = useCallback(() => {
        phaseRef.current = "paused"
        setPhase("paused")
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = 0
        }
    }, [])

    const reset = useCallback(() => {
        phaseRef.current = "idle"
        setPhase("idle")
        generationRef.current = 0
        setGeneration(0)
        timeAccumulatorRef.current = 0
        totalStepsRef.current = 0
        setCreatures([])
        creaturesRef.current = []
        setFitnessHistory([])
        setProgress(0)
        setBestCreatureEver(null)
        setCurrentGenomes([])
        targetReachedFiredRef.current = false
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = 0
        }
    }, [])

    const loop = (time: number) => {
        const currentConfig = configRef.current
        if (phaseRef.current === "idle" || phaseRef.current === "paused" || !currentConfig.topology) return

        const currentTargetZone = {
            x: currentConfig.targetDistance,
            y: (currentConfig.groundY ?? 600) - 100,
            width: 100,
            height: 80,
        }

        let deltaTime = time - lastTimeRef.current
        lastTimeRef.current = time
        if (deltaTime > 1000) deltaTime = 16

        const scaledDelta = deltaTime * (currentConfig.simulationSpeed ?? 1)

        const currentPhase = phaseRef.current
        const TOTAL_GENERATION_STEPS = Math.round(currentConfig.generationDuration / FIXED_TIMESTEP)

        if (currentPhase === "evaluating") {
            const list = creaturesRef.current
            const remainingSteps = TOTAL_GENERATION_STEPS - totalStepsRef.current

            if (remainingSteps > 0) {
                const ground = { y: currentConfig.groundY ?? 600, friction: GROUND_FRICTION, restitution: 0.3 }
                const wallList = [{ x: 0, normal: { x: 1, y: 0 } }]

                // Background mode throttles at 2500 steps per frame to avoid crashing/freezing UI tab
                // Normal mode allows high speeds but capped to prevent freezing.
                const speedCap = Math.max(100, Math.ceil(100 * (currentConfig.simulationSpeed ?? 1)))
                const stepsToDo = currentConfig.backgroundMode ? Math.min(remainingSteps, 2500) : Math.min(remainingSteps, speedCap)

                const batchUsed = isWasmReadyRef.current && isBatchWasmReady() && stepPhysicsBatch(
                    list, ground, wallList, currentTargetZone,
                    stepsToDo, totalStepsRef.current, FIXED_TIMESTEP,
                    { forceX: 0, forceY: GRAVITY, airResistance: 0.02, constraintIterations: 3, muscleStiffness: MUSCLE_STIFFNESS, leftFootIdx: 0, rightFootIdx: 0 }
                )

                if (!batchUsed) {
                    for (let step = 0; step < stepsToDo; step++) {
                        for (let i = 0; i < list.length; i++) {
                            const c = list[i]
                            if (c.isDead) continue
                            c.muscles.forEach((m) => { m.stiffness = MUSCLE_STIFFNESS })
                            stepPhysics(c, ground, wallList, FIXED_TIMESTEP,
                                { forceY: GRAVITY, airResistance: 0.02, time: (totalStepsRef.current + step) * FIXED_TIMESTEP, constraintIterations: 3 }
                            )
                            checkHeadGroundAndKill(c, currentConfig.groundY ?? 600)
                            const head = c.particles.find((p) => p.isHead || p.id === "head")
                            if (head) c.minHeadY = Math.min(c.minHeadY ?? head.pos.y, head.pos.y)
                            c.currentPos = calculateCenterOfMass(c.particles)
                            c.maxDistance = Math.max(c.maxDistance, c.currentPos.x)
                        }
                    }
                }

                totalStepsRef.current += stepsToDo
                setProgress(Math.round((totalStepsRef.current / TOTAL_GENERATION_STEPS) * 100))

                if (!currentConfig.backgroundMode) {
                    const now = performance.now()
                    if (now - lastUIRenderTimeRef.current > 33) {
                        // Update React state visually for rendering ~30fps
                        setCreatures([...creaturesRef.current])
                        lastUIRenderTimeRef.current = now
                    }
                }
            }

            if (totalStepsRef.current >= TOTAL_GENERATION_STEPS) {
                // Done stepping. Calculate fitness.
                const creatures = creaturesRef.current
                let bestFit = -Infinity
                let totalFit = 0
                let currentBestCreature: Creature | null = null

                for (let i = 0; i < creatures.length; i++) {
                    const c = creatures[i]
                    c.fitness = calculateFitnessAdvanced(c, currentTargetZone, c.startPos.x, groundY)
                    totalFit += c.fitness.total
                    if (c.fitness.total > bestFit) {
                        bestFit = c.fitness.total
                        currentBestCreature = { ...c } // clone best
                    }
                }

                const avgFit = totalFit / creatures.length
                setFitnessHistory(prev => [...prev, { generation: generationRef.current, bestFitness: bestFit, averageFitness: avgFit }])

                setBestCreatureEver(prev => {
                    if (!prev || bestFit > (prev.fitness?.total ?? -Infinity)) {
                        return currentBestCreature
                    }
                    return prev
                })

                if (!currentConfig.backgroundMode) {
                    setCreatures([...creaturesRef.current])
                    lastUIRenderTimeRef.current = performance.now()
                }

                phaseRef.current = "evolving"
                setPhase("evolving")
            }

            animationFrameRef.current = requestAnimationFrame(loop)
            return
        }

        if (currentPhase === "running") {
            // Normal running view (similar to evaluation but throttled to real time)
            timeAccumulatorRef.current += scaledDelta
            const stepTimeMs = FIXED_TIMESTEP * 1000

            let stepsToDo = 0
            if (currentConfig.backgroundMode) {
                // If background mode is ON, instantly skip "running" and do all steps in "evaluating" phase
                phaseRef.current = "evaluating"
                setPhase("evaluating")
                animationFrameRef.current = requestAnimationFrame(loop)
                return
            } else {
                const maxStepsPerFrame = Math.max(10, Math.ceil(10 * (currentConfig.simulationSpeed ?? 1)))
                while (timeAccumulatorRef.current >= stepTimeMs && stepsToDo < maxStepsPerFrame) {
                    timeAccumulatorRef.current -= stepTimeMs
                    stepsToDo++
                }
            }

            if (stepsToDo > 0) {
                const list = creaturesRef.current
                const ground = { y: groundY, friction: GROUND_FRICTION, restitution: 0.3 }
                const wallList = [{ x: 0, normal: { x: 1, y: 0 } }]

                // Prevent stepping past max duration
                stepsToDo = Math.min(stepsToDo, TOTAL_GENERATION_STEPS - totalStepsRef.current)

                const batchUsed = isWasmReadyRef.current && isBatchWasmReady() && stepPhysicsBatch(
                    list, ground, wallList, currentTargetZone,
                    stepsToDo, totalStepsRef.current, FIXED_TIMESTEP,
                    { forceX: 0, forceY: GRAVITY, airResistance: 0.02, constraintIterations: 3, muscleStiffness: MUSCLE_STIFFNESS, leftFootIdx: 0, rightFootIdx: 0 }
                )

                if (!batchUsed) {
                    for (let step = 0; step < stepsToDo; step++) {
                        for (let i = 0; i < list.length; i++) {
                            const c = list[i]
                            if (c.isDead) continue
                            c.muscles.forEach((m) => { m.stiffness = MUSCLE_STIFFNESS })
                            stepPhysics(c, ground, wallList, FIXED_TIMESTEP,
                                { forceY: GRAVITY, airResistance: 0.02, time: (totalStepsRef.current + step) * FIXED_TIMESTEP, constraintIterations: 3 }
                            )
                            checkHeadGroundAndKill(c, groundY)
                            const head = c.particles.find((p) => p.isHead || p.id === "head")
                            if (head) c.minHeadY = Math.min(c.minHeadY ?? head.pos.y, head.pos.y)
                            c.currentPos = calculateCenterOfMass(c.particles)
                            c.maxDistance = Math.max(c.maxDistance, c.currentPos.x)
                        }
                    }
                }

                totalStepsRef.current += stepsToDo
                setProgress(Math.round((totalStepsRef.current / TOTAL_GENERATION_STEPS) * 100))

                // Target-reached detection: fire once per run
                if (!targetReachedFiredRef.current) {
                    const winner = creaturesRef.current.find((c) => c.reachedTarget)
                    if (winner) {
                        targetReachedFiredRef.current = true
                        const cb = currentConfig.onTargetReached
                        if (cb) {
                            phaseRef.current = "paused"
                            setPhase("paused")
                            cancelAnimationFrame(animationFrameRef.current)
                            animationFrameRef.current = 0
                            cb({ ...winner })
                            return
                        }
                    }
                }

                const now = performance.now()
                if (now - lastUIRenderTimeRef.current > 33) {
                    setCreatures([...creaturesRef.current])
                    lastUIRenderTimeRef.current = now
                }

                if (totalStepsRef.current >= TOTAL_GENERATION_STEPS) {
                    phaseRef.current = "evaluating"
                    setPhase("evaluating")
                }
            }

            animationFrameRef.current = requestAnimationFrame(loop)
            return
        }

        if (currentPhase === "evolving") {
            const list = creaturesRef.current
            const worker = evolutionWorkerRef.current

            const evolveFallback = () => {
                const elites = list.sort((a, b) => (b.fitness?.total ?? 0) - (a.fitness?.total ?? 0)).slice(0, currentConfig.elitismCount)
                const parents = list.sort((a, b) => (b.fitness?.total ?? 0) - (a.fitness?.total ?? 0)).slice(0, Math.floor(list.length * currentConfig.parentsTopPercent))
                const nextGenomes = elites.map((c) => c.genome)

                const currentGen = generationRef.current
                while (nextGenomes.length < currentConfig.populationSize) {
                    const p1 = parents[Math.floor(Math.random() * parents.length)]
                    const p2 = parents[Math.floor(Math.random() * parents.length)]
                    let offspring = sbxCrossover(p1.genome, p2.genome, SBX_ETA)
                    offspring = { ...offspring, generation: currentGen + 1 }
                    offspring.genes = offspring.genes.map((gene) => {
                        if (Math.random() > currentConfig.mutationRate) return gene
                        const change = (Math.random() - 0.5) * 2 * currentConfig.mutationStrength
                        return {
                            ...gene,
                            amplitude: Math.max(0.05, Math.min(0.8, gene.amplitude * (1 + change))),
                            frequency: Math.max(0.1, Math.min(5.0, gene.frequency * (1 + change))),
                            phase: Math.max(0, Math.min(Math.PI * 2, gene.phase * (1 + change))),
                        }
                    })
                    nextGenomes.push(offspring)
                }

                const spawnPos = { x: 100, y: (currentConfig.groundY ?? 600) - 30 }
                const newCreatures = nextGenomes.map((genome) => createCreatureFromTopology(currentConfig.topology!, genome, spawnPos))

                applyEvolutionResult(newCreatures)
            }

            const applyEvolutionResult = (newCreatures: Creature[]) => {
                creaturesRef.current = newCreatures
                generationRef.current += 1
                setGeneration(generationRef.current)
                totalStepsRef.current = 0
                timeAccumulatorRef.current = 0
                setProgress(0)
                phaseRef.current = "running"
                setPhase("running")
                const nextGenomes = newCreatures.map((c) => c.genome)
                setCurrentGenomes(nextGenomes)
                if (!currentConfig.backgroundMode) setCreatures([...newCreatures])
                animationFrameRef.current = requestAnimationFrame(loop)
            }

            if (!worker || !worker.isAvailable()) {
                evolveFallback()
                return
            }

            const creatureData: CreatureData[] = list.map((c) => ({
                genome: c.genome,
                fitness: c.fitness!,
            }))

            const config: EvolutionConfig = {
                elitismCount: currentConfig.elitismCount,
                parentsTopPercent: currentConfig.parentsTopPercent,
                mutationRate: currentConfig.mutationRate,
                mutationStrength: currentConfig.mutationStrength,
                populationSize: currentConfig.populationSize,
                currentGeneration: generationRef.current,
            }

            worker.evolve({ creatures: creatureData, config })
                .then((output) => {
                    if (output.error) {
                        evolveFallback()
                        return
                    }
                    const spawnPos = { x: 100, y: (currentConfig.groundY ?? 600) - 30 }
                    const newCreatures = output.genomes.map((genome) => createCreatureFromTopology(currentConfig.topology!, genome, spawnPos))
                    applyEvolutionResult(newCreatures)
                })
                .catch(() => {
                    evolveFallback()
                })

            return
        }

        animationFrameRef.current = requestAnimationFrame(loop)
    }

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current)
            }
        }
    }, [])

    return {
        phase,
        generation,
        creatures,
        progress,
        bestCreatureEver,
        fitnessHistory,
        currentGenomes,
        start,
        stop,
        reset
    }
}
