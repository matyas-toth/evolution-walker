import { PrismaAdapter } from "@auth/prisma-adapter"
import type { Adapter } from "next-auth/adapters"
import type { PrismaClient } from "@/generated/prisma/client"
import { defaultCreatureData } from "./defaultCreature"

/** Creates the user and starter creature atomically for OAuth onboarding. */
export function createAuthAdapter(client: PrismaClient): Adapter {
    return {
        ...PrismaAdapter(client),
        async createUser(user) {
            return client.user.create({
                data: {
                    name: user.name,
                    email: user.email,
                    emailVerified: user.emailVerified,
                    image: user.image,
                    creatures: { create: defaultCreatureData() },
                },
            })
        },
    }
}
