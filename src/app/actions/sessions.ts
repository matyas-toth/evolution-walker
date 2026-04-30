"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Genome } from "@/core/types/genetics"
import type { TrainingHubConfig } from "@/core/types/simulation"

export interface SaveSessionPayload {
    creatureId: string
    name?: string
    config: TrainingHubConfig
    /** Full latest-generation genome array */
    population: Genome[]
    /** Best genome of the run (cached for leaderboard reads) */
    bestGenome: Genome
    bestFitness: number
    generation: number
    reachedTarget: boolean
}

/** Creates a new TrainingSession snapshot for a creature. */
export async function saveTrainingSession(payload: SaveSessionPayload) {
    const session = await auth()
    if (!session?.user?.id) throw new Error("Unauthorized")

    const creature = await prisma.creature.findUnique({
        where: { id: payload.creatureId },
        select: { userId: true },
    })
    if (!creature) throw new Error("Creature not found")
    if (creature.userId !== session.user.id) throw new Error("Unauthorized")

    const saved = await prisma.trainingSession.create({
        data: {
            creatureId: payload.creatureId,
            name: payload.name,
            config: payload.config as any,
            population: payload.population as any,
            bestGenome: payload.bestGenome as any,
            bestFitness: payload.bestFitness,
            generation: payload.generation,
            reachedTarget: payload.reachedTarget,
            targetDistance: payload.config.targetDistance,
        },
    })

    revalidatePath(`/dashboard/creatures/${payload.creatureId}/train`)
    revalidatePath(`/dashboard/creatures`)

    return { success: true, sessionId: saved.id }
}

/** Returns all training sessions for a creature, newest first. */
export async function getTrainingSessions(creatureId: string) {
    const session = await auth()
    if (!session?.user?.id) throw new Error("Unauthorized")

    return prisma.trainingSession.findMany({
        where: { creatureId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            bestFitness: true,
            generation: true,
            reachedTarget: true,
            targetDistance: true,
            createdAt: true,
            updatedAt: true,
            config: true,
            bestGenome: true,
            population: true,
        },
    })
}

/** Deletes a training session, verifying creature ownership. */
export async function deleteTrainingSession(sessionId: string) {
    const session = await auth()
    if (!session?.user?.id) throw new Error("Unauthorized")

    const ts = await prisma.trainingSession.findUnique({
        where: { id: sessionId },
        include: { creature: { select: { userId: true, id: true } } },
    })
    if (!ts) throw new Error("Session not found")
    if (ts.creature.userId !== session.user.id) throw new Error("Unauthorized")

    await prisma.trainingSession.delete({ where: { id: sessionId } })

    revalidatePath(`/dashboard/creatures/${ts.creature.id}/train`)
    revalidatePath(`/dashboard/creatures`)

    return { success: true }
}
