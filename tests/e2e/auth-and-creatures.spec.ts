import { expect, test } from "@playwright/test"
import { prisma } from "../../src/lib/prisma"
import { createGenome, createTrainingConfig } from "../fixtures/training"
import {
  assertNoFrameworkOverlay,
  assertNoSeriousA11yViolations,
  capturePageFailures,
  login,
  register,
  uniqueIdentity,
} from "./support"

test("protected routes redirect and invalid credentials remain anonymous", async ({ page }) => {
  await page.goto("/dashboard")
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

  await page.goto("/dashboard/creatures")
  await expect(page.getByText(renamed, { exact: true })).toBeVisible()
  await page.getByRole("button", { name: `Delete ${renamed}` }).click()
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByText(renamed, { exact: true })).toHaveCount(0)
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
