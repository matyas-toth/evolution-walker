import { afterEach, describe, expect, it, vi } from "vitest"
import { WebGpuTrainingEngine } from "@/core/training/WebGpuTrainingEngine"
import { createTestTopology, createTrainingConfig } from "../fixtures/training"

function fakeGpu(failBindGroup = false) {
  const buffers: Array<{ destroy: ReturnType<typeof vi.fn> }> = []
  const device = {
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined),
    },
    lost: new Promise<{ message: string }>(() => undefined),
    destroy: vi.fn(),
    createBuffer: vi.fn(({ size }: { size: number }) => {
      const buffer = {
        mapAsync: vi.fn(async () => undefined),
        getMappedRange: vi.fn(() => new ArrayBuffer(size)),
        unmap: vi.fn(),
        destroy: vi.fn(),
      }
      buffers.push(buffer)
      return buffer
    }),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn(async () => ({ messages: [] })),
    })),
    createComputePipelineAsync: vi.fn(async () => ({ getBindGroupLayout: vi.fn(() => ({})) })),
    createBindGroup: vi.fn(() => {
      if (failBindGroup) throw new Error("bind group failed")
      return {}
    }),
    createCommandEncoder: vi.fn(),
  }
  vi.stubGlobal("navigator", {
    hardwareConcurrency: 8,
    gpu: { requestAdapter: vi.fn(async () => ({ requestDevice: vi.fn(async () => device) })) },
  })
  return { device, buffers }
}

afterEach(() => vi.unstubAllGlobals())

describe("WebGpuTrainingEngine lifecycle", () => {
  it("tracks retained memory and destroys every buffer and the device", async () => {
    const { device, buffers } = fakeGpu()
    const engine = await WebGpuTrainingEngine.create(
      createTestTopology(),
      createTrainingConfig({ populationSize: 2_000, backend: "webgpu" }),
    )

    expect(engine.getSnapshot("paused", false).diagnostics.memoryBytes).toBeGreaterThan(0)
    engine.dispose()

    expect(buffers.length).toBeGreaterThan(0)
    expect(buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true)
    expect(device.destroy).toHaveBeenCalledOnce()
    expect(engine.getSnapshot("paused", false).diagnostics.memoryBytes).toBe(0)
    engine.dispose()
    expect(device.destroy).toHaveBeenCalledOnce()
  })

  it("cleans up buffers and the device when initialization fails partway through", async () => {
    const { device, buffers } = fakeGpu(true)

    await expect(WebGpuTrainingEngine.create(
      createTestTopology(),
      createTrainingConfig({ populationSize: 500, backend: "webgpu" }),
    )).rejects.toThrow("bind group failed")

    expect(buffers.length).toBeGreaterThan(0)
    expect(buffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true)
    expect(device.destroy).toHaveBeenCalledOnce()
  })
})
