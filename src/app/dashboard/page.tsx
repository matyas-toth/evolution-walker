/**
 * Dashboard home page showing welcome message and quick actions.
 * @module app/dashboard/page
 */

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { Dna, ArrowRight, Activity } from "lucide-react"
import { TrainingSessionsTable, type DashboardTrainingSession } from "@/components/dashboard/TrainingSessionsTable"
import type { TrainingHubConfig } from "@/core/types"

export default async function DashboardPage() {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return null

    const [creatureCount, trainingSessions] = await Promise.all([
        prisma.creature.count({ where: { userId } }),
        prisma.trainingSession.findMany({
            where: { creature: { userId } },
            orderBy: { updatedAt: "desc" },
            select: {
                id: true,
                name: true,
                generation: true,
                bestFitness: true,
                targetDistance: true,
                reachedTarget: true,
                updatedAt: true,
                config: true,
                creature: { select: { id: true, name: true } },
            },
        }),
    ])
    const serializedSessions: DashboardTrainingSession[] = trainingSessions.map((trainingSession) => {
        const config = trainingSession.config as unknown as Partial<TrainingHubConfig>
        const recordedDistance = config.policyState?.bestSustainedDistance
        const bestDistance = Number.isFinite(recordedDistance)
            ? Math.max(0, recordedDistance as number)
            : null
        return {
            id: trainingSession.id,
            name: trainingSession.name,
            creatureId: trainingSession.creature.id,
            creatureName: trainingSession.creature.name,
            generation: trainingSession.generation,
            bestDistance,
            bestFitness: trainingSession.bestFitness,
            targetDistance: trainingSession.targetDistance,
            reachedTarget: trainingSession.reachedTarget,
            updatedAt: trainingSession.updatedAt.toISOString(),
        }
    })

    return (
        <div className="mx-auto w-full max-w-7xl p-8">
            <div className="mb-8">
                <h1 className="text-2xl font-bold tracking-tight">
                    Welcome back{session?.user?.name ? `, ${session.user.name}` : ""}
                </h1>
                <p className="text-muted-foreground mt-1">
                    Design creatures and watch them evolve
                </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
                <Link
                    href="/dashboard/creatures"
                    className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/30 hover:bg-card/80"
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                            <Dna className="h-5 w-5 text-primary" />
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-lg">Creatures</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            {creatureCount} creature{creatureCount !== 1 ? "s" : ""} designed
                        </p>
                    </div>
                </Link>

                <Link
                    href="#training-sessions"
                    className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/30 hover:bg-card/80"
                >
                    <div className="flex items-center justify-between">
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
                            <Activity className="h-5 w-5 text-primary" />
                        </div>
                        <ArrowRight className="h-4 w-4 rotate-90 text-muted-foreground transition-transform group-hover:translate-y-1" />
                    </div>
                    <div>
                        <h2 className="font-semibold text-lg">Training Sessions</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            {serializedSessions.length} saved checkpoint{serializedSessions.length !== 1 ? "s" : ""}
                        </p>
                    </div>
                </Link>
            </div>

            <TrainingSessionsTable sessions={serializedSessions} />
        </div>
    )
}
