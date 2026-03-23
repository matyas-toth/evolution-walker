import { notFound, redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { TrainingHub } from "@/components/training/TrainingHub"
import type { Topology } from "@/core/types"

export default async function TrainCreaturePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params
    const session = await auth()
    if (!session?.user?.id) redirect("/login")

    const creature = await prisma.creature.findUnique({
        where: { id },
    })

    if (!creature) notFound()
    if (creature.userId !== session.user.id) notFound()

    return (
        <TrainingHub
            creatureId={creature.id}
            creatureName={creature.name}
            topology={creature.topology as any as Topology}
        />
    )
}
