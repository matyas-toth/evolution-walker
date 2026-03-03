/**
 * NextAuth.js configuration with Credentials provider and Prisma adapter.
 * Uses JWT sessions for credential-based auth (email + password).
 * @module lib/auth
 */

import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import { PrismaAdapter } from "@auth/prisma-adapter"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import type { Adapter } from "next-auth/adapters";


import { authConfig } from "./auth.config"

class InvalidCredentialsError extends CredentialsSignin {
    code = "invalid_credentials"
}

const credentialsSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    adapter: PrismaAdapter(prisma),
    providers: [
        Credentials({
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                const parsed = credentialsSchema.safeParse(credentials)
                if (!parsed.success) throw new InvalidCredentialsError()

                const { email, password } = parsed.data
                const user = await prisma.user.findUnique({ where: { email } })
                if (!user?.password) throw new InvalidCredentialsError()

                const valid = await bcrypt.compare(password, user.password)
                if (!valid) throw new InvalidCredentialsError()

                return { id: user.id, name: user.name, email: user.email }
            },
        }),
    ],
})
