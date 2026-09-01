import { mkdir, writeFile } from "node:fs/promises"
import { cpus, platform, release, totalmem } from "node:os"
import { join } from "node:path"
import { expect, test, type Page } from "@playwright/test"

type Backend = "legacy" | "wasm-scalar" | "wasm-simd" | "webgpu"

interface BenchmarkResult {
  timestamp: string
  machine: string
  platform: string
  backendRequested: Backend
  backendActive: string
  seed: number
  population: number
  generationDuration: number
  backgroundMode: boolean
  observedSeconds: number
  generationDelta: number
  generationsPerSecond: number
  memoryMb: number
  pauseAcknowledgementMs: number
  droppedSnapshots: number
  stageTimings: {
    initializeMs: number
    simulationMs: number
    fitnessMs: number
    evolutionMs: number
    resetMs: number
    transferMs: number
    totalGenerationMs: number
  }
  finalBestFitness: number
}

function parseList<T extends string | number>(value: string | undefined, defaults: T[], parse: (item: string) => T) {
  return value ? value.split(",").map(item => parse(item.trim())) : defaults
}

async function registerAndOpenTraining(page: Page) {
  const email = `benchmark-${Date.now()}@example.test`
  await page.goto("/register")
  await page.getByLabel("Name").fill("Benchmark User")
  await page.getByLabel("Email").fill(email)
  await page.getByLabel("Password", { exact: true }).fill("benchmark-password")
  await page.getByLabel("Confirm Password").fill("benchmark-password")
  await page.getByRole("button", { name: "Create account" }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await page.goto("/dashboard/creatures")
  const card = page.getByText("Stickman", { exact: true }).locator("../..").locator("..")
  await card.hover()
  await card.getByTitle("Train Creature").click()
  await expect(page.getByRole("heading", { name: "Training Hub" })).toBeVisible()
}

async function setSlider(slider: ReturnType<Page["getByRole"]>, value: number, min: number, step: number) {
  await slider.press("Home")
  const increments = Math.round((value - min) / step)
  for (let i = 0; i < increments; i += 1) await slider.press("ArrowRight")
}

function metric(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("..").locator(".font-mono").first()
}

test("records the seeded production training matrix", async ({ page }) => {
  const backends = parseList(process.env.BENCHMARK_BACKENDS, ["legacy", "wasm-scalar", "wasm-simd", "webgpu"] as Backend[], value => value as Backend)
  const populations = parseList(process.env.BENCHMARK_POPULATIONS, [100, 500, 2000], Number)
  const durations = parseList(process.env.BENCHMARK_DURATIONS, [3, 10, 30], Number)
  const modes = parseList(process.env.BENCHMARK_MODES, ["visible", "background"], value => value)
  const observedSeconds = Number(process.env.BENCHMARK_OBSERVE_SECONDS ?? 2)
  const results: BenchmarkResult[] = []

  await registerAndOpenTraining(page)
  for (const backend of backends) {
    for (const population of populations) {
      for (const generationDuration of durations) {
        for (const mode of modes) {
          await page.getByLabel("Compute Backend").selectOption(backend)
          const sliders = page.getByRole("slider")
          await setSlider(sliders.nth(0), population, 10, 10)
          await setSlider(sliders.nth(2), generationDuration, 3, 1)
          await sliders.nth(5).press("End")
          const backgroundSwitch = page.getByRole("switch")
          const desiredBackground = mode === "background"
          if ((await backgroundSwitch.isChecked()) !== desiredBackground) await backgroundSwitch.click()
          if (!desiredBackground) await sliders.nth(1).press("End")

          const generationBefore = Number(await metric(page, "Generation").textContent())
          const startedAt = performance.now()
          await page.getByRole("button", { name: "Start Evolution" }).click()
          await page.waitForTimeout(observedSeconds * 1000)
          const pauseStartedAt = performance.now()
          await page.getByRole("button", { name: "Pause Evolution" }).click()
          await expect(page.getByRole("button", { name: "Resume" })).toBeVisible()
          const pauseAcknowledgementMs = performance.now() - pauseStartedAt
          const elapsedSeconds = (performance.now() - startedAt) / 1000
          const generationAfter = Number(await metric(page, "Generation").textContent())
          const rateText = await metric(page, desiredBackground ? "Throughput" : "Paced rate").textContent()
          const memoryText = await metric(page, "Memory").textContent()
          const best = Number(await metric(page, "Max Fitness").textContent())
          const diagnostics = page.getByTestId("training-sidebar")
          const readDiagnostic = async (name: string) => Number(await diagnostics.getAttribute(name) ?? 0)
          results.push({
            timestamp: new Date().toISOString(),
            machine: `${cpus()[0]?.model ?? "unknown"}; ${cpus().length} logical CPUs; ${(totalmem() / 1073741824).toFixed(1)} GiB`,
            platform: `${platform()} ${release()}`,
            backendRequested: backend,
            backendActive: (await metric(page, "Engine").textContent())?.trim() ?? "unknown",
            seed: 0x6d2b79f5,
            population,
            generationDuration,
            backgroundMode: desiredBackground,
            observedSeconds: elapsedSeconds,
            generationDelta: generationAfter - generationBefore,
            generationsPerSecond: Number.parseFloat(rateText ?? "0"),
            memoryMb: Number.parseFloat(memoryText ?? "0"),
            pauseAcknowledgementMs,
            droppedSnapshots: await readDiagnostic("data-dropped-snapshots"),
            stageTimings: {
              initializeMs: await readDiagnostic("data-stage-initialize-ms"),
              simulationMs: await readDiagnostic("data-stage-simulation-ms"),
              fitnessMs: await readDiagnostic("data-stage-fitness-ms"),
              evolutionMs: await readDiagnostic("data-stage-evolution-ms"),
              resetMs: await readDiagnostic("data-stage-reset-ms"),
              transferMs: await readDiagnostic("data-stage-transfer-ms"),
              totalGenerationMs: await readDiagnostic("data-stage-total-ms"),
            },
            finalBestFitness: best,
          })
          await page.getByRole("button", { name: "Reset" }).click()
        }
      }
    }
  }

  const outputDirectory = join(process.cwd(), "benchmarks", "results")
  await mkdir(outputDirectory, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(":", "-")
  await writeFile(join(outputDirectory, `${stamp}.json`), JSON.stringify(results, null, 2))
  const columns = Object.keys(results[0] ?? {}) as (keyof BenchmarkResult)[]
  const csvCell = (value: unknown) => {
    const serialized = typeof value === "object" ? JSON.stringify(value) : String(value)
    return `"${serialized.replaceAll('"', '""')}"`
  }
  const csv = [columns.join(","), ...results.map(row => columns.map(column => csvCell(row[column])).join(","))].join("\n")
  await writeFile(join(outputDirectory, `${stamp}.csv`), csv)
  expect(results).toHaveLength(backends.length * populations.length * durations.length * modes.length)
})
