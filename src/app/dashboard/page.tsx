/**
 * Dashboard home page showing welcome message and quick actions.
 * @module app/dashboard/page
 */

import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { Dna, ArrowRight } from "lucide-react"

export default async function DashboardPage() {
    const session = await auth()

    const creatureCount = await prisma.creature.count({
        where: { userId: session?.user?.id ?? "" },
    })

    return (
        <div className="p-8 max-w-4xl">
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

                <div className="flex flex-col gap-4 rounded-xl border border-dashed border-border/60 p-6 opacity-50">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-muted">
                            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className="text-muted-foreground">
                                <path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                            </svg>
                        </div>
                    </div>
                    <div>
                        <h2 className="font-semibold text-lg">Training Sessions</h2>
                        <p className="text-sm text-muted-foreground mt-0.5">Coming soon</p>
                    </div>
                </div>
            </div>
        </div>
    )
}
