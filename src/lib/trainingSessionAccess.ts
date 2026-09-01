import { prisma } from "@/lib/prisma"

/** Loads a session only when it belongs to both the requested creature and authenticated owner. */
export function findOwnedTrainingSession(sessionId: string, creatureId: string, userId: string) {
    return prisma.trainingSession.findFirst({
        where: {
            id: sessionId,
            creatureId,
            creature: { userId },
        },
        select: {
            id: true,
            config: true,
            population: true,
            bestGenome: true,
            generation: true,
        },
    })
}
