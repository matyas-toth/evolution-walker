import { expect, test } from "@playwright/test"
import { assertNoFrameworkOverlay, capturePageFailures } from "./support"

const routes = [
  "/",
  "/showcase/learning-basics",
  "/showcase/advanced-learning",
  "/showcase/genetic-algorithm",
  "/showcase/physics-engine",
  "/showcase/punishment-directed-learning",
]

for (const route of routes) {
  test(`smoke-loads ${route}`, async ({ page }) => {
    const failures = capturePageFailures(page)
    const response = await page.goto(route)
    expect(response?.ok()).toBe(true)
    await expect(page.locator("body")).toBeVisible()
    await assertNoFrameworkOverlay(page)
    expect(failures).toEqual([])
  })
}

