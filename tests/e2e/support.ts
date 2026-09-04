import AxeBuilder from "@axe-core/playwright"
import { expect, type Page, type TestInfo } from "@playwright/test"

export interface TestIdentity {
  name: string
  email: string
  password: string
}

export function uniqueIdentity(testInfo: TestInfo, prefix = "thesis"): TestIdentity {
  const slug = `${testInfo.workerIndex}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  return {
    name: `${prefix} user`,
    email: `${prefix}-${slug}@example.test`,
    password: "correct-horse-battery-staple",
  }
}

export async function register(page: Page, identity: TestIdentity) {
  await page.goto("/register")
  await page.getByLabel("Name").fill(identity.name)
  await page.getByLabel("Email").fill(identity.email)
  await page.getByLabel("Password", { exact: true }).fill(identity.password)
  await page.getByLabel("Confirm Password").fill(identity.password)
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 })
}

export async function login(page: Page, identity: TestIdentity) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(identity.email)
  await page.getByLabel("Password").fill(identity.password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 })
}

export async function assertNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze()
  const important = results.violations.filter(violation =>
    violation.impact === "critical" || violation.impact === "serious"
  )
  expect(important, important.map(v => `${v.id}: ${v.help}`).join("\n")).toEqual([])
}

export function capturePageFailures(page: Page) {
  const failures: string[] = []
  page.on("pageerror", error => failures.push(`pageerror: ${error.message}`))
  page.on("console", message => {
    if (message.type() === "error") failures.push(`console: ${message.text()}`)
  })
  return failures
}

export async function assertNoFrameworkOverlay(page: Page) {
  await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0)
  await expect(page.getByText(/Unhandled Runtime Error|Application error/i)).toHaveCount(0)
}
