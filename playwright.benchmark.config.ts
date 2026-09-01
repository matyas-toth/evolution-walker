import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./tests/benchmark",
  timeout: 900_000,
  retries: 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3100",
    url: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
