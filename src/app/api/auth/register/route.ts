/**
 * Registration API endpoint.
 * Creates a new user with hashed password and a default stickman creature.
 * @module app/api/auth/register/route
 */

import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { Prisma } from "../../../../generated/prisma"
import { STICKMAN_TOPOLOGY } from "@/core/topology"

const registerSchema = z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
    password: z.string().min(6, "Password must be at least 6 characters"),
})

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const parsed = registerSchema.safeParse(body)

        if (!parsed.success) {
            return NextResponse.json(
                { error: parsed.error.issues[0]?.message ?? "Invalid input" },
                { status: 400 }
            )
        }

        const { name, email, password } = parsed.data

        const existing = await prisma.user.findUnique({ where: { email } })
        if (existing) {
            return NextResponse.json(
                { error: "An account with this email already exists" },
                { status: 409 }
            )
        }

        const hashedPassword = await bcrypt.hash(password, 12)

        const user = await prisma.user.create({
            data: {
                name,
                email,
                password: hashedPassword,
                creatures: {
                    create: {
                        name: "Stickman",
                        topology: JSON.parse(JSON.stringify(STICKMAN_TOPOLOGY)) as Prisma.InputJsonValue,
                    },
                },
            },
        })

        return NextResponse.json(
            { id: user.id, name: user.name, email: user.email },
            { status: 201 }
        )
    } catch {
        return NextResponse.json(
            { error: "Something went wrong" },
            { status: 500 }
        )
    }
}
