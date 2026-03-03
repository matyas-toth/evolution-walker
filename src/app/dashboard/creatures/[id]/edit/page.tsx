/**
 * Creature editor page.
 * Loads the creature from the database and renders the full-screen editor.
 * @module app/dashboard/creatures/[id]/edit/page
 */

import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { CreatureEditor } from "@/components/editor/CreatureEditor"
import type { Topology } from "@/core/types"

export default async function CreatureEditPage({
    params,
}: {
    params: Promise<{ id: string }>
}) {
    const { id } = await params
    const session = await auth()
    if (!session?.user?.id) return notFound()

    const creature = await prisma.creature.findUnique({
        where: { id },
    })

    if (!creature || creature.userId !== session.user.id) return notFound()

    const topology = creature.topology as unknown as Topology

    return (
        <CreatureEditor
            creatureId={creature.id}
            initialName={creature.name}
            initialTopology={topology}
        />
    )
}
