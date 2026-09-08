import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

interface TrainingExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  training_alloc_f32(length: number): number
  training_init(pointer: number, length: number): number
  training_run_steps(steps: number): number
  training_finish_generation(): void
  training_evaluate_generation(): void
  training_dispose(): void
  training_generation(): number
  training_genomes_ptr(): number
  training_genomes_len(): number
  training_summary_ptr(): number
  training_summary_len(): number
  training_evaluation_metrics_ptr(): number
  training_evaluation_metrics_len(): number
}

function engineInput(seed: number, population = 2, steps = 3): Float32Array {
  return new Float32Array([
    population, 2, 1, 1, steps, 1, seed,
    0.2, 0.4, 1, 0.5, 1400, 600, 570,
    0, -20, 1, 5, 0, 1, 0,
    20, 0, 1, 5, 0, 0, 1,
    0, 1, 20, 0.9, 0,
    ...Array.from({ length: population }, (_, index) => [0.2 + index * 0.0001, 1, 0]).flat(),
  ])
}

async function runArtifact(file: string) {
  const bytes = await readFile(path.resolve("public", file))
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const exports = instance.exports as TrainingExports
  const input = engineInput(12345)
  const pointer = exports.training_alloc_f32(input.length)
  new Float32Array(exports.memory.buffer, pointer, input.length).set(input)
  expect(exports.training_init(pointer, input.length)).toBe(1)
  expect(exports.training_run_steps(2)).toBe(0)
  expect(exports.training_run_steps(2)).toBe(1)
  exports.training_finish_generation()
  const summary = Array.from(new Float32Array(
    exports.memory.buffer,
    exports.training_summary_ptr(),
    exports.training_summary_len(),
  ))
  return { exports, summary }
}

describe.each(["training-engine-scalar.wasm", "training-engine-simd.wasm"])("%s", artifact => {
  it("exposes the stable ABI and completes a seeded generation", async () => {
    const { exports, summary } = await runArtifact(artifact)
    expect(exports.training_generation()).toBe(2)
    expect(summary).toHaveLength(12)
    expect(summary.every(Number.isFinite)).toBe(true)
    const metrics = new Float32Array(
      exports.memory.buffer,
      exports.training_evaluation_metrics_ptr(),
      exports.training_evaluation_metrics_len(),
    )
    expect(metrics).toHaveLength(20)
    expect([...metrics].every(Number.isFinite)).toBe(true)
  })

  it("evaluates without replacing the population and disposes its retained state", async () => {
    const bytes = await readFile(path.resolve("public", artifact))
    const { instance } = await WebAssembly.instantiate(bytes, {})
    const exports = instance.exports as TrainingExports
    const input = engineInput(17)
    const pointer = exports.training_alloc_f32(input.length)
    new Float32Array(exports.memory.buffer, pointer, input.length).set(input)
    expect(exports.training_init(pointer, input.length)).toBe(1)
    expect(exports.training_run_steps(3)).toBe(1)
    const before = Array.from(new Float32Array(
      exports.memory.buffer,
      exports.training_genomes_ptr(),
      exports.training_genomes_len(),
    ))

    exports.training_evaluate_generation()

    const after = Array.from(new Float32Array(
      exports.memory.buffer,
      exports.training_genomes_ptr(),
      exports.training_genomes_len(),
    ))
    expect(after).toEqual(before)
    expect(exports.training_generation()).toBe(2)
    exports.training_dispose()
    expect(exports.training_generation()).toBe(0)
    expect(exports.training_genomes_len()).toBe(0)
  })

  it("initializes and evaluates the maximum supported population", async () => {
    const bytes = await readFile(path.resolve("public", artifact))
    const { instance } = await WebAssembly.instantiate(bytes, {})
    const exports = instance.exports as TrainingExports
    const input = engineInput(23, 2_000, 1)
    const pointer = exports.training_alloc_f32(input.length)
    new Float32Array(exports.memory.buffer, pointer, input.length).set(input)
    expect(exports.training_init(pointer, input.length)).toBe(1)
    expect(exports.training_run_steps(1)).toBe(1)
    exports.training_evaluate_generation()
    expect(exports.training_evaluation_metrics_len()).toBe(20_000)
    exports.training_dispose()
  })
})

it("keeps scalar and SIMD invariant-compatible for the same seed", async () => {
  const scalar = await runArtifact("training-engine-scalar.wasm")
  const simd = await runArtifact("training-engine-simd.wasm")
  expect(simd.summary.slice(0, 5)).toEqual(scalar.summary.slice(0, 5))
})
