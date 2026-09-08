import { describe, expect, it } from "vitest"
import { selectTopIndices } from "@/core/training/engineBackend"

describe("training backend helpers", () => {
  it("selects a stable bounded top-k without a population-sized result", () => {
    const values = [4, Number.NaN, 9, 9, 2, 8, 7, 10, 1]
    expect(selectTopIndices(values.length, 5, (index) => values[index])).toEqual([7, 2, 3, 5, 6])
    expect(selectTopIndices(2_000, 5, (index) => index)).toEqual([1_999, 1_998, 1_997, 1_996, 1_995])
  })
})
