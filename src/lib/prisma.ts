import { PrismaMariaDb } from "@prisma/adapter-mariadb"
import { PrismaClient } from "@/generated/prisma/client"

function databaseConfig() {
    const explicitHost = process.env.DATABASE_HOST
    const explicitUser = process.env.DATABASE_USER
    const explicitDatabase = process.env.DATABASE_DB
    if (explicitHost && explicitUser && explicitDatabase) {
        return {
            host: explicitHost,
            port: Number(process.env.DATABASE_PORT ?? 3306),
            user: explicitUser,
            password: process.env.DATABASE_PASSWORD ?? "",
            database: explicitDatabase,
            connectionLimit: 10,
        }
    }

    const rawUrl = process.env.DATABASE_URL
    if (!rawUrl) throw new Error("DATABASE_URL or DATABASE_* variables must be configured")
    const url = new URL(rawUrl)
    return {
        host: url.hostname,
        port: Number(url.port || 3306),
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: decodeURIComponent(url.pathname.replace(/^\//, "")),
        connectionLimit: Number(url.searchParams.get("connection_limit") ?? 10),
    }
}

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }
const adapter = new PrismaMariaDb(databaseConfig())
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter, log: ["error", "warn"] })

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
