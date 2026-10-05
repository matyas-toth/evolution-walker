/**
 * NextAuth.js configuration with Credentials provider and Prisma adapter.
 * Uses JWT sessions for credential-based auth (email + password).
 * @module lib/auth
 */

import NextAuth, { CredentialsSignin } from "next-auth"
import Credentials from "next-auth/providers/credentials"
import Google from "next-auth/providers/google"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { authConfig } from "./auth.config"
import { createAuthAdapter } from "./authAdapter"

class InvalidCredentialsError extends CredentialsSignin {
    code = "invalid_credentials"
}

const credentialsSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
})

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    adapter: createAuthAdapter(prisma),
    callbacks: {
        ...authConfig.callbacks,
        async signIn({ account, profile }) {
            return account?.provider !== "google" || profile?.email_verified === true
        },
    },
    providers: [
        ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
            ? [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })]
            : []),
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
