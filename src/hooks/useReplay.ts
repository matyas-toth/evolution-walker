"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { createCreatureFromTopology, calculateCenterOfMass } from "@/core/simulation/creature"
import { stepPhysics, loadPhysicsWasm } from "@/core/physics"
import type { Genome, Creature, Topology } from "@/core/types"

const FIXED_TIMESTEP = 1 / 60
const GRAVITY = 200
const MUSCLE_STIFFNESS = 0.9
const GROUND_FRICTION = 0.7
const GROUND_Y = 600
const REPLAY_DURATION_S = 12

/**
 * Re-simulates a single genome at 1× speed for cinematic replay.
 * Loops automatically until stopped.
 */
export function useReplay(topology: Topology | null) {
    const [replayCreature, setReplayCreature] = useState<Creature | null>(null)
    const [isReplaying, setIsReplaying] = useState(false)
    const [replayProgress, setReplayProgress] = useState(0)

    const creatureRef = useRef<Creature | null>(null)
    const rafRef = useRef<number>(0)
    const lastTimeRef = useRef<number>(0)
    const accumulatorRef = useRef<number>(0)
    const stepsRef = useRef<number>(0)
    const genomeRef = useRef<Genome | null>(null)
    const isReadyRef = useRef(false)

    const TOTAL_STEPS = Math.round(REPLAY_DURATION_S / FIXED_TIMESTEP)

    useEffect(() => {
        loadPhysicsWasm().then(() => { isReadyRef.current = true })
    }, [])

    const spawnCreature = useCallback((genome: Genome): Creature | null => {
        if (!topology) return null
        return createCreatureFromTopology(topology, genome, { x: 100, y: GROUND_Y - 30 })
    }, [topology])

    const loop = useCallback((time: number) => {
        if (!creatureRef.current || !genomeRef.current) return

        const delta = Math.min(time - lastTimeRef.current, 100)
        lastTimeRef.current = time
        accumulatorRef.current += delta

        const stepMs = FIXED_TIMESTEP * 1000
        const ground = { y: GROUND_Y, friction: GROUND_FRICTION, restitution: 0.3 }
        const wallList = [{ x: 0, normal: { x: 1, y: 0 } }]

        while (accumulatorRef.current >= stepMs) {
            accumulatorRef.current -= stepMs
            const c = creatureRef.current
            if (!c.isDead) {
                c.muscles.forEach((m) => { m.stiffness = MUSCLE_STIFFNESS })
                stepPhysics(c, ground, wallList, FIXED_TIMESTEP, {
                    forceY: GRAVITY,
                    airResistance: 0.02,
                    time: stepsRef.current * FIXED_TIMESTEP,
                    constraintIterations: 3,
                })
                c.currentPos = calculateCenterOfMass(c.particles)
                stepsRef.current++
            }

            // Loop replay when done
            if (stepsRef.current >= TOTAL_STEPS) {
                const fresh = spawnCreature(genomeRef.current)
                if (fresh) {
                    creatureRef.current = fresh
                    stepsRef.current = 0
                    accumulatorRef.current = 0
                }
            }
        }

        setReplayProgress(Math.min(stepsRef.current / TOTAL_STEPS, 1))
        setReplayCreature({ ...creatureRef.current })
        rafRef.current = requestAnimationFrame(loop)
    }, [spawnCreature, TOTAL_STEPS])

    const startReplay = useCallback((genome: Genome) => {
        if (!topology) return
        genomeRef.current = genome
        const creature = spawnCreature(genome)
        if (!creature) return
        creatureRef.current = creature
        stepsRef.current = 0
        accumulatorRef.current = 0
        lastTimeRef.current = performance.now()
        setIsReplaying(true)
        setReplayProgress(0)
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(loop)
    }, [topology, spawnCreature, loop])

    const stopReplay = useCallback(() => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = 0
        }
        setIsReplaying(false)
        setReplayCreature(null)
        setReplayProgress(0)
        creatureRef.current = null
        genomeRef.current = null
    }, [])

    useEffect(() => {
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
    }, [])

    return { replayCreature, isReplaying, replayProgress, startReplay, stopReplay }
}
