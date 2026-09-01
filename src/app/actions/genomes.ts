"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import type { Genome } from "@/core/types/genetics"
import { Prisma } from "@/generated/prisma"

export async function saveGenome(
    creatureId: string,
    weights: Genome,
    fitness: number,
    reachedTarget: boolean,
    name?: string
) {
    const session = await auth()
    if (!session?.user?.id) {
        throw new Error("Unauthorized")
    }

    // Verify creature belongs to user
    const creature = await prisma.creature.findUnique({
        where: { id: creatureId },
        select: { userId: true },
    })

    if (!creature) {
        throw new Error("Creature not found")
    }

    if (creature.userId !== session.user.id) {
        throw new Error("Unauthorized: You do not own this creature")
    }

    // Save the genome
    const genome = await prisma.genome.create({
        data: {
            creatureId,
            name,
            weights: weights as unknown as Prisma.InputJsonValue,
            fitness,
            reachedTarget,
        },
    })

    revalidatePath(`/dashboard/creatures/${creatureId}/train`)
    revalidatePath(`/dashboard/creatures/${creatureId}`)

    return { success: true, genomeId: genome.id }
}

export async function getGenomes(creatureId: string) {
    const session = await auth()
    if (!session?.user?.id) {
        throw new Error("Unauthorized")
    }

    const creature = await prisma.creature.findFirst({
        where: { id: creatureId, userId: session.user.id },
        select: { id: true },
    })
    if (!creature) throw new Error("Unauthorized")

    const genomes = await prisma.genome.findMany({
        where: { creatureId },
        orderBy: { fitness: 'desc' },
    })

    return genomes
}
