// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useReplay } from "@/hooks/useReplay"
import { createReplay } from "../fixtures/training"

beforeEach(() => {
  vi.useFakeTimers()
  let clock = 0
  vi.spyOn(performance, "now").mockImplementation(() => clock)
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => setTimeout(() => {
    clock += 17
    callback(clock)
  }, 17) as unknown as number) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof cancelAnimationFrame
})

afterEach(() => vi.useRealTimers())

describe("useReplay", () => {
  it("plays frames, holds contact, then loops", () => {
    const replay = createReplay({ frameRate: 10, reachedFrame: 2, frameCount: 3 })
    const { result } = renderHook(() => useReplay(replay))
    expect(result.current).toMatchObject({ frameIndex: 0, replayProgress: 0, isReplaying: true })
    act(() => vi.advanceTimersByTime(220))
    expect(result.current.frameIndex).toBe(2)
    expect(result.current.replayProgress).toBe(1)
    act(() => vi.advanceTimersByTime(760))
    expect(result.current.frameIndex).toBeLessThan(2)
  })

  it("resets on replay replacement and cancels animation on unmount", () => {
    const { result, rerender, unmount } = renderHook(({ replay }) => useReplay(replay), {
      initialProps: { replay: createReplay() as ReturnType<typeof createReplay> | null },
    })
    act(() => vi.advanceTimersByTime(50))
    rerender({ replay: null })
    expect(result.current).toEqual({ frameIndex: 0, replayProgress: 0, isReplaying: false })
    const pending = vi.getTimerCount()
    unmount()
    expect(vi.getTimerCount()).toBeLessThanOrEqual(pending)
  })

  it("does not animate a replay without a reached frame", () => {
    const { result } = renderHook(() => useReplay(createReplay({ reachedFrame: -1 })))
    act(() => vi.advanceTimersByTime(100))
    expect(result.current.frameIndex).toBe(0)
    expect(result.current.replayProgress).toBe(0)
  })
})
