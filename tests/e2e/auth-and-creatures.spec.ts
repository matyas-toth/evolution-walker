import { expect, test } from "@playwright/test"
import path from "node:path"
import { tmpdir } from "node:os"
import { prisma } from "../../src/lib/prisma"
import { createGenome, createTestTopology, createTrainingConfig } from "../fixtures/training"
import {
  assertNoFrameworkOverlay,
  assertNoSeriousA11yViolations,
  capturePageFailures,
  login,
  register,
  uniqueIdentity,
} from "./support"

test("protected routes redirect and invalid credentials remain anonymous", async ({ page }) => {
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/auth/providers")),
    page.goto("/dashboard"),
  ])
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel("Email").fill("missing@example.test")
  await page.getByLabel("Password").fill("not-the-password")
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page.getByText("Invalid email or password")).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  await assertNoSeriousA11yViolations(page)
})

test("registration creates the default creature and login persists", async ({ page }, testInfo) => {
  const identity = uniqueIdentity(testInfo, "registration")
  const failures = capturePageFailures(page)
  await register(page, identity)
  await page.goto("/dashboard/creatures")
  await expect(page.getByText("Stickman", { exact: true })).toBeVisible()
  await assertNoSeriousA11yViolations(page)
  await assertNoFrameworkOverlay(page)

  await page.context().clearCookies()
  await login(page, identity)
  expect(failures).toEqual([])
})

test("a creature can be created, renamed, saved, and deleted", async ({ page }, testInfo) => {
  const identity = uniqueIdentity(testInfo, "crud")
  const name = `Thesis Walker ${testInfo.workerIndex}`
  const renamed = `${name} Revised`
  await register(page, identity)
  await page.goto("/dashboard/creatures")

  await page.getByRole("button", { name: "New Creature" }).first().click()
  await page.getByLabel("Name").fill(name)
  await page.getByRole("button", { name: "Create", exact: true }).click()
  await expect(page).toHaveURL(/\/edit$/)
  const nameInput = page.locator("header input, input").first()
  await expect(nameInput).toHaveValue(name)
  await nameInput.fill(renamed)
  await page.getByRole("button", { name: "Save" }).click()
  await expect(page.getByText(/^Saved /)).toBeVisible()

  await nameInput.fill(`${renamed} Training`)
  await page.getByRole("button", { name: "Train", exact: true }).click()
  await expect(page).toHaveURL(/\/train$/)
  await expect(page.getByRole("heading", { name: "Training Hub" })).toBeVisible()
  await expect(page.getByRole("heading", { name: `${renamed} Training`, exact: true })).toBeVisible()
  const savedCreature = await prisma.creature.findFirstOrThrow({ where: { name: `${renamed} Training` } })
  await page.goto(`/dashboard/creatures/${savedCreature.id}/edit`)
  await page.getByLabel("Creature name").fill(renamed)
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText(/^Saved /)).toBeVisible()

  await page.goto("/dashboard/creatures")
  await expect(page.getByText(renamed, { exact: true })).toBeVisible()
  await page.getByRole("button", { name: `Delete ${renamed}` }).click()
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByText(renamed, { exact: true })).toHaveCount(0)
})

test("editor uses unique IDs and automatic lengths while preserving material defaults", async ({ page }, testInfo) => {
  const failures = capturePageFailures(page)
  const identity = uniqueIdentity(testInfo, "editor")
  await register(page, identity)
  const owner = await prisma.user.findUniqueOrThrow({ where: { email: identity.email } })
  const topology = createTestTopology()
  topology.particles = [
    { ...topology.particles[0], id: "particle-1", initialPos: { x: -80, y: 0 } },
    { ...topology.particles[1], id: "particle-3", initialPos: { x: 80, y: 0 } },
  ]
  topology.constraints = [{ ...topology.constraints[0], p1Id: "particle-1", p2Id: "particle-3", restLength: 160 }]
  topology.muscles = [{ ...topology.muscles[0], p1Id: "particle-1", p2Id: "particle-3", baseLength: 160 }]
  const creature = await prisma.creature.create({ data: { name: "Editor regression", userId: owner.id, topology: topology as never } })
  await page.goto(`/dashboard/creatures/${creature.id}/edit`)
  await expect(page).toHaveTitle("Evolution Walker")
  const canvas = page.locator("canvas")
  await expect(canvas).toBeVisible()
  // Opening preview proves hydration and the canvas camera initialization have completed.
  await page.getByRole("button", { name: "Start Preview" }).click()
  await expect(page.getByRole("button", { name: "Stop Preview" })).toBeVisible()
  await page.getByRole("button", { name: "Stop Preview" }).click()
  const box = (await canvas.boundingBox())!
  await canvas.click({ position: { x: box.width / 2 - 80, y: box.height / 2 } })
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("-80")
  await page.getByLabel("X", { exact: true }).fill("-100")
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } })
  await expect(page.getByText("Length (automatic): 180.0 px")).toBeVisible()
  await expect(page.getByText("Stiffness", { exact: true })).toHaveCount(0)
  await expect(page.getByText("Damping", { exact: true })).toHaveCount(0)
  await page.screenshot({ path: path.join(tmpdir(), "evolution-editor-automatic-length.png"), fullPage: true })
  await page.getByRole("button", { name: "Add Particle" }).click()
  await canvas.click({ position: { x: box.width / 2 - 80, y: box.height / 2 - 80 } })
  await expect(page.getByText("particle-4", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.getByText(/^Saved /)).toBeVisible()
  const saved = await prisma.creature.findUniqueOrThrow({ where: { id: creature.id } })
  const savedTopology = saved.topology as unknown as typeof topology
  expect(new Set(savedTopology.particles.map(p => p.id)).size).toBe(savedTopology.particles.length)
  expect(savedTopology.constraints[0]).toMatchObject({ restLength: 180, stiffness: 0.9, damping: 0 })
  expect(savedTopology.muscles[0]).toMatchObject({ baseLength: 180, stiffness: 0.9, damping: 0 })
  await assertNoFrameworkOverlay(page)
  expect(failures).toEqual([])
})

test("foreign creature and training-session URLs resolve as not found", async ({ page }, testInfo) => {
  const owner = uniqueIdentity(testInfo, "url-owner")
  await register(page, owner)
  const ownerRecord = await prisma.user.findUniqueOrThrow({
    where: { email: owner.email },
    include: { creatures: true },
  })
  const creature = ownerRecord.creatures.find(item => item.name === "Stickman")!
  const genome = createGenome()
  const session = await prisma.trainingSession.create({
    data: {
      creatureId: creature.id,
      name: "Private Session",
      config: createTrainingConfig() as never,
      population: [genome] as never,
      bestGenome: genome as never,
      bestFitness: 1,
      generation: 3,
      targetDistance: 200,
    },
  })

  await page.context().clearCookies()
  const intruder = uniqueIdentity(testInfo, "url-intruder")
  await register(page, intruder)
  const intruderRecord = await prisma.user.findUniqueOrThrow({
    where: { email: intruder.email },
    include: { creatures: true },
  })
  const intruderCreature = intruderRecord.creatures.find(item => item.name === "Stickman")!

  await page.goto(`/dashboard/creatures/${creature.id}/train?session=${session.id}`)
  await expect(page.getByText(/This page could not be found/i)).toBeVisible()
  await page.goto(`/dashboard/creatures/${intruderCreature.id}/train?session=${session.id}`)
  await expect(page.getByRole("heading", { name: "Training Hub" })).toBeVisible()
  await expect(page.getByText("Resumed Session")).toHaveCount(0)
  await expect(page.getByText("Generation", { exact: true }).locator("..").locator(".font-mono").first()).toHaveText("0")
  await assertNoFrameworkOverlay(page)
})
