import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { createGenome, createTestTopology, createTrainingConfig } from "../fixtures/training"

const authMock = vi.hoisted(() => vi.fn())
vi.mock("@/lib/auth", () => ({ auth: authMock }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { POST as register } from "@/app/api/auth/register/route"
import { GET as listCreatures, POST as createCreatureRoute } from "@/app/api/creatures/route"
import {
  DELETE as deleteCreatureRoute,
  GET as getCreatureRoute,
  PATCH as updateCreatureRoute,
} from "@/app/api/creatures/[id]/route"
import { saveGenome, getGenomes } from "@/app/actions/genomes"
import { saveTrainingSession, getTrainingSessions, deleteTrainingSession } from "@/app/actions/sessions"
import { findOwnedTrainingSession } from "@/lib/trainingSessionAccess"

async function clearDatabase() {
  await prisma.trainingSession.deleteMany()
  await prisma.genome.deleteMany()
  await prisma.creature.deleteMany()
  await prisma.session.deleteMany()
  await prisma.account.deleteMany()
  await prisma.user.deleteMany()
}

async function createUser(email: string) {
  return prisma.user.create({ data: { name: email, email, password: await bcrypt.hash("password", 4) } })
}

async function createCreature(userId: string, name = "Walker") {
  return prisma.creature.create({
    data: { name, userId, topology: createTestTopology() as never },
  })
}

beforeEach(clearDatabase)
afterEach(() => authMock.mockReset())

describe("registration", () => {
  it("validates input, hashes the password, and creates the default Stickman", async () => {
    const invalid = await register(new Request("http://test/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "A", email: "bad", password: "123" }),
    }))
    expect(invalid.status).toBe(400)

    const response = await register(new Request("http://test/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "Ada", email: "ada@example.test", password: "password" }),
    }))
    expect(response.status).toBe(201)
    const user = await prisma.user.findUnique({ where: { email: "ada@example.test" }, include: { creatures: true } })
    expect(user?.password).not.toBe("password")
    expect(await bcrypt.compare("password", user!.password)).toBe(true)
    expect(user?.creatures.map(creature => creature.name)).toEqual(["Stickman"])

    const duplicate = await register(new Request("http://test/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "Ada", email: "ada@example.test", password: "password" }),
    }))
    expect(duplicate.status).toBe(409)
  })
})

describe("ownership and JSON persistence", () => {
  it("enforces creature CRUD ownership through the HTTP route contract", async () => {
    const owner = await createUser("api-owner@example.test")
    const intruder = await createUser("api-intruder@example.test")
    authMock.mockResolvedValue(null)
    expect((await listCreatures()).status).toBe(401)

    authMock.mockResolvedValue({ user: { id: owner.id } })
    const invalid = await createCreatureRoute(new Request("http://test/api/creatures", {
      method: "POST",
      body: JSON.stringify({ name: "" }),
    }))
    expect(invalid.status).toBe(400)
    const createdResponse = await createCreatureRoute(new Request("http://test/api/creatures", {
      method: "POST",
      body: JSON.stringify({ name: "API Walker", topology: createTestTopology() }),
    }))
    expect(createdResponse.status).toBe(201)
    const created = await createdResponse.json()
    expect(await (await listCreatures()).json()).toEqual([
      expect.objectContaining({ id: created.id, name: "API Walker" }),
    ])

    const context = { params: Promise.resolve({ id: created.id as string }) }
    authMock.mockResolvedValue({ user: { id: intruder.id } })
    expect((await getCreatureRoute(new Request("http://test"), context)).status).toBe(403)
    expect((await updateCreatureRoute(new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ name: "Stolen" }),
    }), context)).status).toBe(403)
    expect((await deleteCreatureRoute(new Request("http://test"), context)).status).toBe(403)

    authMock.mockResolvedValue({ user: { id: owner.id } })
    const updated = await updateCreatureRoute(new Request("http://test", {
      method: "PATCH",
      body: JSON.stringify({ name: "API Walker Revised" }),
    }), context)
    expect(updated.status).toBe(200)
    expect((await updated.json()).name).toBe("API Walker Revised")
    expect((await deleteCreatureRoute(new Request("http://test"), context)).status).toBe(200)
    expect(await prisma.creature.count({ where: { id: created.id } })).toBe(0)
  })

  it("round-trips genomes and denies another user's reads", async () => {
    const owner = await createUser("owner@example.test")
    const intruder = await createUser("intruder@example.test")
    const creature = await createCreature(owner.id)
    authMock.mockResolvedValue({ user: { id: owner.id } })
    const genome = createGenome()
    await saveGenome(creature.id, genome, 42, false, "Run")
    const stored = await getGenomes(creature.id)
    expect(stored).toHaveLength(1)
    expect(stored[0].weights).toEqual(genome)

    authMock.mockResolvedValue({ user: { id: intruder.id } })
    await expect(getGenomes(creature.id)).rejects.toThrow("Unauthorized")
  })

  it("saves, lists, resumes, and deletes only owned training sessions", async () => {
    const owner = await createUser("owner@example.test")
    const intruder = await createUser("intruder@example.test")
    const creature = await createCreature(owner.id)
    const foreignCreature = await createCreature(intruder.id, "Foreign")
    authMock.mockResolvedValue({ user: { id: owner.id } })
    const genome = createGenome()
    const saved = await saveTrainingSession({
      creatureId: creature.id,
      name: "Session",
      config: createTrainingConfig(),
      population: [genome],
      bestGenome: genome,
      bestFitness: 42,
      generation: 7,
      reachedTarget: false,
    })
    expect(await getTrainingSessions(creature.id)).toHaveLength(1)
    expect(await findOwnedTrainingSession(saved.sessionId, creature.id, owner.id)).toMatchObject({ generation: 7 })
    expect(await findOwnedTrainingSession(saved.sessionId, foreignCreature.id, intruder.id)).toBeNull()

    authMock.mockResolvedValue({ user: { id: intruder.id } })
    await expect(getTrainingSessions(creature.id)).rejects.toThrow("Unauthorized")
    await expect(deleteTrainingSession(saved.sessionId)).rejects.toThrow("Unauthorized")

    authMock.mockResolvedValue({ user: { id: owner.id } })
    await expect(deleteTrainingSession(saved.sessionId)).resolves.toEqual({ success: true })
    expect(await prisma.trainingSession.count()).toBe(0)
  })

  it("cascades creature deletion to genomes and sessions", async () => {
    const owner = await createUser("owner@example.test")
    const creature = await createCreature(owner.id)
    const genome = createGenome()
    await prisma.genome.create({ data: { creatureId: creature.id, weights: genome as never, fitness: 1 } })
    await prisma.trainingSession.create({
      data: {
        creatureId: creature.id,
        config: createTrainingConfig() as never,
        population: [genome] as never,
        bestGenome: genome as never,
        bestFitness: 1,
        generation: 1,
        targetDistance: 200,
      },
    })
    await prisma.creature.delete({ where: { id: creature.id } })
    expect(await prisma.genome.count()).toBe(0)
    expect(await prisma.trainingSession.count()).toBe(0)
  })
})
