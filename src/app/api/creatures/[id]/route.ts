/**
 * Single creature API endpoints.
 * Handles read, update, and delete for a specific creature owned by the authenticated user.
 * @module app/api/creatures/[id]/route
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const updateCreatureSchema = z.object({
    name: z.string().min(1).max(100).optional(),
    topology: z.object({
        id: z.string(),
        name: z.string(),
        particles: z.array(z.any()),
        constraints: z.array(z.any()),
        muscles: z.array(z.any()),
    }).optional(),
})

async function getAuthedCreature(creatureId: string) {
    const session = await auth()
    if (!session?.user?.id) return { error: "Unauthorized", status: 401 }

    const creature = await prisma.creature.findUnique({
        where: { id: creatureId },
    })

    if (!creature) return { error: "Creature not found", status: 404 }
    if (creature.userId !== session.user.id) return { error: "Forbidden", status: 403 }

    return { creature, userId: session.user.id }
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const result = await getAuthedCreature(id)
    if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result.creature)
}

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const result = await getAuthedCreature(id)
    if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: result.status })
    }

    try {
        const body = await request.json()
        const parsed = updateCreatureSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? "Invalid input" },
                { status: 400 }
            )
        }

        const data: Record<string, unknown> = {}
        if (parsed.data.name) data.name = parsed.data.name
        if (parsed.data.topology) data.topology = parsed.data.topology as Prisma.InputJsonValue

        const updated = await prisma.creature.update({
            where: { id },
            data,
        })

        return NextResponse.json(updated)
    } catch {
        return NextResponse.json(
            { error: "Failed to update creature" },
            { status: 500 }
        )
    }
}

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const result = await getAuthedCreature(id)
    if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: result.status })
    }

    await prisma.creature.delete({ where: { id } })
    return NextResponse.json({ success: true })
}
