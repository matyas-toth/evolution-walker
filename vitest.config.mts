import path from "node:path"
import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["tests/e2e/**", "tests/integration/**", "tests/benchmark/**"],
    setupFiles: ["./tests/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
    mockReset: true,
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage",
      include: [
        "src/core/physics/**/*.ts",
        "src/core/genetics/**/*.ts",
        "src/core/topology/**/*.ts",
        "src/core/simulation/**/*.ts",
        "src/core/training/{packedCpuEngine,replayCapture,world,types,TrainingEngineClient}.ts",
        "src/hooks/{useEvolution,useReplay}.ts",
      ],
      exclude: [
        "src/**/*.d.ts",
        "src/generated/**",
        "src/core/genetics/*.worker.ts",
        "src/core/genetics/evolutionWorker.ts",
        "src/core/physics/wasm*.ts",
        "src/core/**/index.ts",
        "src/core/topology/stickman.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
        "src/core/{physics,genetics,topology,simulation}/**/*.ts": {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90,
        },
      },
    },
  },
})
