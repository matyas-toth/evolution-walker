import { STICKMAN_TOPOLOGY } from "@/core/topology"
import type { Prisma } from "@/generated/prisma/client"

/** Shared onboarding data for password registration and OAuth-created users. */
export function defaultCreatureData() {
    return {
        name: "Stickman",
        topology: JSON.parse(JSON.stringify(STICKMAN_TOPOLOGY)) as Prisma.InputJsonValue,
    }
}
