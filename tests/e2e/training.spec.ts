import { expect, test } from "@playwright/test"
import {
  assertNoFrameworkOverlay,
  assertNoSeriousA11yViolations,
  capturePageFailures,
  register,
  uniqueIdentity,
} from "./support"

function metric(page: import("@playwright/test").Page, name: string) {
  return page.getByText(name, { exact: true }).locator("..").locator(".font-mono").first()
}

async function openStickmanTraining(page: import("@playwright/test").Page) {
  await page.goto("/dashboard/creatures")
  const card = page.getByText("Stickman", { exact: true }).locator("../..").locator("..")
  await card.hover()
  await card.getByTitle("Train Creature").click()
  await expect(page.getByRole("heading", { name: "Training Hub" })).toBeVisible()
  await page.getByLabel("Compute Backend").selectOption("wasm-scalar")
}

test("training supports live pacing, pause, backend preservation, resume, and reset", async ({ page }, testInfo) => {
  test.slow()
  const failures = capturePageFailures(page)
  await register(page, uniqueIdentity(testInfo, "training"))
  await openStickmanTraining(page)
  await assertNoSeriousA11yViolations(page)

  const speed = page.getByRole("slider").nth(1)
  await speed.press("End")
  await expect(page.getByText("Simulation Speed: 100x")).toBeVisible()
  await page.getByRole("button", { name: "Start Evolution" }).click()
  await expect(page.getByRole("button", { name: "Pause Evolution" })).toBeVisible()
  await expect.poll(async () => Number(await metric(page, "Generation").textContent()), { timeout: 20_000 }).toBeGreaterThan(1)

  await speed.press("Home")
  await expect(page.getByText("Simulation Speed: 0.1x")).toBeVisible()
  await page.getByRole("button", { name: "Pause Evolution" }).click()
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible()
  const generationBeforeSwitch = Number(await metric(page, "Generation").textContent())
  const historyBeforeSwitch = await page.getByTestId("fitness-chart").locator("circle").count()

  await page.getByLabel("Compute Backend").selectOption("wasm-simd")
  await expect(metric(page, "Engine")).toHaveText("wasm-simd", { timeout: 20_000 })
  await expect(metric(page, "Generation")).toHaveText(String(generationBeforeSwitch))
  await expect(page.getByTestId("fitness-chart").locator("circle")).toHaveCount(historyBeforeSwitch)
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible()

  await speed.press("End")
  await page.getByRole("button", { name: "Resume" }).click()
  await expect.poll(async () => Number(await metric(page, "Generation").textContent()), { timeout: 20_000 }).toBeGreaterThan(generationBeforeSwitch)
  await page.getByRole("button", { name: "Pause Evolution" }).click()
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible()
  const savedGeneration = Number(await metric(page, "Generation").textContent())
  const sessionName = `E2E Session ${testInfo.workerIndex}`
  await page.getByPlaceholder(/Run, Gen/).fill(sessionName)
  const saveProgress = page.getByRole("button", { name: "Save Current Progress" })
  await expect(saveProgress).toBeEnabled()
  await saveProgress.click()
  await expect(page.getByText("Progress saved successfully.")).toBeVisible({ timeout: 15_000 })

  await page.goto("/dashboard")
  const dashboardSession = page.getByRole("row").filter({ hasText: sessionName })
  await expect(dashboardSession).toContainText("Stickman")
  await expect(dashboardSession).toContainText(String(savedGeneration))
  await expect(dashboardSession).toContainText("In progress")
  await dashboardSession.getByRole("link", { name: "Resume" }).click()
  await expect(page).toHaveURL(/\?session=/)
  await expect(metric(page, "Generation")).toHaveText(String(savedGeneration))

  await page.goto("/dashboard/creatures")
  const card = page.getByText("Stickman", { exact: true }).locator("../..").locator("..")
  await card.hover()
  await card.getByTitle("View Runs & Leaderboard").click()
  await expect(page.getByText(sessionName, { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Load & Continue" }).click()
  await expect(page).toHaveURL(/\?session=/)
  await expect(metric(page, "Generation")).toHaveText(String(savedGeneration))
  await page.getByRole("button", { name: "Reset" }).click()
  await expect(metric(page, "Generation")).toHaveText("0")

  await page.getByRole("button", { name: "Back to creatures" }).click()
  await expect(page).toHaveURL(/\/dashboard\/creatures$/)
  const savedCard = page.getByText("Stickman", { exact: true }).locator("../..").locator("..")
  await savedCard.hover()
  await savedCard.getByTitle("View Runs & Leaderboard").click()
  await page.getByRole("button", { name: `Delete ${sessionName}` }).click()
  await page.getByRole("button", { name: "Delete", exact: true }).click()
  await expect(page.getByText(sessionName, { exact: true })).toHaveCount(0)
  await assertNoFrameworkOverlay(page)
  expect(failures).toEqual([])
})

test("WASM SIMD resumes after pausing and disabling background mode", async ({ page }, testInfo) => {
  test.slow()
  const failures = capturePageFailures(page)
  await register(page, uniqueIdentity(testInfo, "background"))
  await openStickmanTraining(page)
  await page.getByLabel("Compute Backend").selectOption("wasm-simd")
  await expect(metric(page, "Engine")).toHaveText("wasm-simd", { timeout: 20_000 })
  await page.getByRole("switch", { name: "Background Mode" }).click()
  await expect(page.getByText(/Runs unpaced at maximum compute throughput/)).toBeVisible()
  await expect(page.getByRole("slider").nth(1)).toBeDisabled()
  await page.getByRole("button", { name: "Start Evolution" }).click()
  await expect.poll(async () => Number(await metric(page, "Generation").textContent()), { timeout: 20_000 }).toBeGreaterThan(1)
  await page.getByRole("button", { name: "Pause Evolution" }).click()
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible()
  const pausedGeneration = Number(await metric(page, "Generation").textContent())
  await page.getByRole("switch", { name: "Background Mode" }).click()
  await page.getByRole("button", { name: "Resume" }).click()
  await expect.poll(async () => Number(await metric(page, "Generation").textContent()), { timeout: 20_000 }).toBeGreaterThan(pausedGeneration)
  await page.getByRole("button", { name: "Pause Evolution" }).click()
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible()
  await assertNoFrameworkOverlay(page)
  expect(failures).toEqual([])
})

test("target contact atomically pauses and opens the exact fixed-camera victory replay", async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await register(page, uniqueIdentity(testInfo, "victory"))
  await openStickmanTraining(page)
  const sliders = page.getByRole("slider")
  await sliders.nth(2).press("Home")
  await sliders.nth(5).press("Home")
  await page.getByRole("switch").click()
  await page.getByRole("button", { name: "Start Evolution" }).click()

  await expect(page.getByRole("heading", { name: "Target Distance Reached" })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole("button", { name: "Resume" })).toBeVisible()
  const sidebarProgress = page.getByText("Progress", { exact: true }).first().locator("..")
  await expect(sidebarProgress.getByText("100%", { exact: true })).toBeVisible()
  await expect(page.getByLabel("Exact winning trajectory replay")).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled()
  const victoryGeneration = Number(await metric(page, "Generation").textContent())
  const historyBeforeContinue = await page.getByTestId("fitness-chart").locator("circle").count()
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page.getByRole("heading", { name: "Target Distance Reached" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Pause Evolution" })).toBeVisible()
  await expect.poll(async () => Number(await metric(page, "Generation").textContent())).toBeGreaterThanOrEqual(victoryGeneration)
  await expect.poll(async () => page.getByTestId("fitness-chart").locator("circle").count()).toBeGreaterThanOrEqual(historyBeforeContinue)
})
