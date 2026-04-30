import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { TrainingHub } from "@/components/training/TrainingHub"
import type { Topology } from "@/core/types"

export default async function TrainCreaturePage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
    const { id } = await params
    const resolvedSearchParams = await searchParams
    const sessionId = resolvedSearchParams.session as string | undefined

    const session = await auth()
    if (!session?.user?.id) redirect("/login")

    const creature = await prisma.creature.findUnique({
        where: { id },
    })

    if (!creature) notFound()
    if (creature.userId !== session.user.id) notFound()

    let initialSession = undefined
    if (sessionId) {
        const ts = await prisma.trainingSession.findUnique({
            where: { id: sessionId },
            select: { id: true, config: true, population: true, bestGenome: true, generation: true }
        })
        if (ts) {
            initialSession = {
                id: ts.id,
                config: ts.config as any,
                population: ts.population as any,
                bestGenome: ts.bestGenome as any,
                generation: ts.generation,
            }
        }
    }

    return (
        <TrainingHub
            creatureId={creature.id}
            creatureName={creature.name}
            topology={creature.topology as any as Topology}
            initialSession={initialSession}
        />
    )
}
