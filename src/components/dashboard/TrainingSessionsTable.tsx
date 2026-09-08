import Link from "next/link"
import { CheckCircle2, Play, Timer } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyMedia,
    EmptyTitle,
} from "@/components/ui/empty"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

export interface DashboardTrainingSession {
    id: string
    name: string | null
    creatureId: string
    creatureName: string
    generation: number
    bestDistance: number | null
    bestFitness: number
    targetDistance: number
    reachedTarget: boolean
    updatedAt: string
}

interface TrainingSessionsTableProps {
    sessions: DashboardTrainingSession[]
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

/** Compact all-creature view of resumable training checkpoints. */
export function TrainingSessionsTable({ sessions }: TrainingSessionsTableProps) {
    return (
        <section id="training-sessions" className="mt-10 scroll-mt-8">
            <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                    <h2 className="text-lg font-semibold tracking-tight">Training sessions</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Every saved checkpoint, ready to continue.
                    </p>
                </div>
                <span className="text-xs tabular-nums text-muted-foreground">
                    {sessions.length} saved
                </span>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
                {sessions.length === 0 ? (
                    <Empty className="min-h-52">
                        <EmptyHeader>
                            <EmptyMedia variant="icon"><Timer /></EmptyMedia>
                            <EmptyTitle>No saved training sessions yet</EmptyTitle>
                            <EmptyDescription>
                                Train a creature and save its progress to create a resumable checkpoint.
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button asChild variant="outline" size="sm">
                                <Link href="/dashboard/creatures">Choose a creature</Link>
                            </Button>
                        </EmptyContent>
                    </Empty>
                ) : (
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="min-w-52 pl-5">Session</TableHead>
                                    <TableHead className="min-w-40">Creature</TableHead>
                                    <TableHead className="text-right">Best distance</TableHead>
                                    <TableHead className="text-right">Fitness</TableHead>
                                    <TableHead className="text-right">Target</TableHead>
                                    <TableHead className="text-right">Generations</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="min-w-32">Updated</TableHead>
                                    <TableHead className="w-28 pr-5 text-right"><span className="sr-only">Actions</span></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {sessions.map((session) => (
                                    <TableRow key={session.id} className="group">
                                        <TableCell className="pl-5 font-medium">
                                            {session.name || `Generation ${session.generation}`}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{session.creatureName}</TableCell>
                                        <TableCell className="text-right font-mono tabular-nums">
                                            {session.bestDistance === null ? "—" : numberFormat.format(session.bestDistance)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                                            {numberFormat.format(session.bestFitness)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                                            {numberFormat.format(session.targetDistance)}
                                        </TableCell>
                                        <TableCell className="text-right font-mono tabular-nums">
                                            {numberFormat.format(session.generation)}
                                        </TableCell>
                                        <TableCell>
                                            {session.reachedTarget ? (
                                                <Badge>
                                                    <CheckCircle2 data-icon="inline-start" /> Finished
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">
                                                    <Timer data-icon="inline-start" /> In progress
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {new Date(session.updatedAt).toLocaleDateString()}
                                        </TableCell>
                                        <TableCell className="pr-5 text-right">
                                            <Button asChild variant="outline" size="sm">
                                                <Link href={`/dashboard/creatures/${session.creatureId}/train?session=${session.id}`}>
                                                    <Play data-icon="inline-start" /> Resume
                                                </Link>
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>
        </section>
    )
}
