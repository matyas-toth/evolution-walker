import { afterAll, beforeAll } from "vitest"
import { prisma } from "@/lib/prisma"

function assertIsolatedDatabase() {
  const url = process.env.DATABASE_URL ?? ""
  if (!url.includes("evolution_test")) {
    throw new Error("Integration tests refuse to run outside the disposable evolution_test database")
  }
}

beforeAll(() => assertIsolatedDatabase())

afterAll(async () => {
  await prisma.$disconnect()
})
