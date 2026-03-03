/**
 * Creatures API endpoints.
 * Handles CRUD operations for the authenticated user's creatures.
 * @module app/api/creatures/route
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

const createCreatureSchema = z.object({
    name: z.string().min(1).max(100),
    topology: z.object({
        id: z.string(),
        name: z.string(),
        particles: z.array(z.any()),
        constraints: z.array(z.any()),
        muscles: z.array(z.any()),
    }).optional(),
})

export async function GET() {
    const session = await auth()
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const creatures = await prisma.creature.findMany({
        where: { userId: session.user.id },
        orderBy: { updatedAt: "desc" },
        select: {
            id: true,
            name: true,
            topology: true,
            createdAt: true,
            updatedAt: true,
        },
    })

    return NextResponse.json(creatures)
}

export async function POST(request: Request) {
    const session = await auth()
    if (!session?.user?.id) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    try {
        const body = await request.json()
        const parsed = createCreatureSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? "Invalid input" },
                { status: 400 }
            )
        }

        const { name, topology } = parsed.data
        const defaultTopology = topology ?? {
            id: name.toLowerCase().replace(/\s+/g, "-"),
            name,
            particles: [],
            constraints: [],
            muscles: [],
        }

        const creature = await prisma.creature.create({
            data: {
                name,
                topology: defaultTopology as Prisma.InputJsonValue,
                userId: session.user.id,
            },
        })

        return NextResponse.json(creature, { status: 201 })
    } catch {
        return NextResponse.json(
            { error: "Failed to create creature" },
            { status: 500 }
        )
    }
}
