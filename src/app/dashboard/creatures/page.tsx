/**
 * Creatures list page showing all user's creatures with create/delete actions.
 * @module app/dashboard/creatures/page
 */

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { CreaturesGrid } from "@/components/creatures/CreaturesGrid"
import type { Topology } from "@/core/types"

export default async function CreaturesPage() {
    const session = await auth()
    if (!session?.user?.id) return null

    const creatures = await prisma.creature.findMany({
        where: { userId: session.user.id },
        orderBy: { updatedAt: "desc" },
        include: {
            _count: {
                select: { trainingSessions: true }
            },
            trainingSessions: {
                where: { reachedTarget: true },
                select: { id: true },
                take: 1
            }
        }
    })

    const serialized = creatures.map((c) => ({
        id: c.id,
        name: c.name,
        topology: c.topology as unknown as Topology,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        _count: c._count,
        hasReachedTarget: c.trainingSessions.length > 0
    }))

    return (
        <div className="p-8">
            <CreaturesGrid creatures={serialized} />
        </div>
    )
}
