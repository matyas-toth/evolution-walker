import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

interface TrainingExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory
  training_alloc_f32(length: number): number
  training_init(pointer: number, length: number): number
  training_run_steps(steps: number): number
  training_finish_generation(): void
  training_generation(): number
  training_summary_ptr(): number
  training_summary_len(): number
  training_evaluation_metrics_ptr(): number
  training_evaluation_metrics_len(): number
}

function engineInput(seed: number): Float32Array {
  return new Float32Array([
    2, 2, 1, 1, 3, 1, seed,
    0.2, 0.4, 1, 0.5, 1400, 600, 570,
    0, -20, 1, 5, 0, 1, 0,
    20, 0, 1, 5, 0, 0, 1,
    0, 1, 20, 0.9, 0,
    0.2, 1, 0,
    0.3, 1, 0,
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
})

it("keeps scalar and SIMD invariant-compatible for the same seed", async () => {
  const scalar = await runArtifact("training-engine-scalar.wasm")
  const simd = await runArtifact("training-engine-simd.wasm")
  expect(simd.summary.slice(0, 5)).toEqual(scalar.summary.slice(0, 5))
})
