import { afterEach, describe, expect, it, vi } from "vitest"
import fc from "fast-check"
import {
  arithmeticCrossover,
  calculateFitness,
  calculateFitnessAdvanced,
  createInitialPopulation,
  createRandomGenome,
  mutateGenome,
  sbxCrossover,
  selectElites,
  selectElitesAndParents,
  selectParents,
  tournamentSelection,
  uniformCrossover,
  uniformCrossoverWithBias,
} from "@/core/genetics"
import { createCreature, createGenome, createTestTopology } from "../fixtures/training"

afterEach(() => vi.restoreAllMocks())

describe("population and mutation", () => {
  it("creates one bounded gene per muscle and requested population size", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    vi.spyOn(Date, "now").mockReturnValue(123)
    const genome = createRandomGenome(createTestTopology(), 3)
    expect(genome).toMatchObject({ generation: 3, createdAt: 123 })
    expect(genome.genes).toHaveLength(1)
    expect(genome.genes[0]).toMatchObject({ amplitude: 0.35, frequency: 1.1, phase: Math.PI })
    expect(createInitialPopulation(createTestTopology(), 5)).toHaveLength(5)
  })

  it("does not mutate when probability misses and clamps all changed components", () => {
    const genome = createGenome({ genes: [{ muscleId: "muscle", amplitude: 0.8, frequency: 5, phase: Math.PI * 2 }] })
    vi.spyOn(Math, "random").mockReturnValueOnce(1)
    expect(mutateGenome(genome, 0)).toEqual(genome)
    vi.spyOn(Math, "random").mockReturnValue(0.999)
    const mutated = mutateGenome(genome, 1, 100)
    expect(mutated.genes[0].amplitude).toBeLessThanOrEqual(0.8)
    expect(mutated.genes[0].frequency).toBeLessThanOrEqual(5)
    expect(mutated.genes[0].phase).toBeLessThanOrEqual(Math.PI * 2)
  })

  it("preserves mutation bounds under arbitrary valid genomes", () => {
    fc.assert(fc.property(fc.double({ min: 0.05, max: 0.8, noNaN: true }), amplitude => {
      vi.spyOn(Math, "random").mockReturnValue(0)
      const result = mutateGenome(createGenome({ genes: [{ muscleId: "muscle", amplitude, frequency: 1, phase: 1 }] }), 1, 2)
      expect(result.genes[0].amplitude).toBeGreaterThanOrEqual(0.05)
      expect(result.genes[0].amplitude).toBeLessThanOrEqual(0.8)
    }))
  })
})

describe("selection", () => {
  const population = [createCreature(1), createCreature(10), createCreature(5), createCreature(20)]

  it("selects sorted elites and top parent fraction without mutating input", () => {
    const original = [...population]
    expect(selectElites(population, 2).map(creature => creature.fitness.total)).toEqual([20, 10])
    expect(selectParents(population, 0.5).map(creature => creature.fitness.total)).toEqual([20, 10])
    expect(selectElitesAndParents(population, 1, 0.5).sorted.map(creature => creature.fitness.total)).toEqual([20, 10, 5, 1])
    expect(population).toEqual(original)
  })

  it("handles empty populations and caps counts", () => {
    expect(selectElites([], 4)).toEqual([])
    expect(selectParents([], 0.5)).toEqual([])
    expect(selectElitesAndParents([], 1)).toEqual({ elites: [], parents: [], sorted: [] })
    expect(selectElites(population, 99)).toHaveLength(population.length)
  })

  it("runs deterministic tournament selection and rejects empty input", () => {
    vi.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.3).mockReturnValueOnce(0.9)
    expect(tournamentSelection(population, 3).fitness.total).toBe(20)
    expect(() => tournamentSelection([])).toThrow(/empty/)
  })
})

describe("crossovers", () => {
  const left = createGenome({ id: "left", generation: 2, genes: [{ muscleId: "muscle", amplitude: 0.2, frequency: 1, phase: 0.5 }] })
  const right = createGenome({ id: "right", generation: 4, genes: [{ muscleId: "muscle", amplitude: 0.6, frequency: 3, phase: 2.5 }] })

  it("supports uniform extremes and records lineage", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    expect(uniformCrossoverWithBias(left, right, 1).genes[0]).toBe(left.genes[0])
    expect(uniformCrossoverWithBias(left, right, 0).genes[0]).toBe(right.genes[0])
    expect(uniformCrossover(left, right)).toMatchObject({ generation: 5, parentIds: ["left", "right"] })
  })

  it("blends arithmetic components and clamps alpha", () => {
    const middle = arithmeticCrossover(left, right, 0.5)
    expect(middle.genes[0]).toMatchObject({ amplitude: 0.4, frequency: 2, phase: 1.5 })
    expect(arithmeticCrossover(left, right, 99).genes[0]).toMatchObject(left.genes[0])
  })

  it("keeps SBX output within mutation bounds", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.25)
    const child = sbxCrossover(left, right, 10)
    expect(child.genes[0].amplitude).toBeWithin(0.05, 0.8)
    expect(child.genes[0].frequency).toBeWithin(0.1, 5)
    expect(child.genes[0].phase).toBeWithin(0, Math.PI * 2)
  })

  it("covers expansive SBX branches, swapped parents, and both offspring", () => {
    const random = vi.spyOn(Math, "random")
    random.mockReturnValueOnce(0.75).mockReturnValueOnce(0.25)
      .mockReturnValueOnce(0.75).mockReturnValueOnce(0.75)
      .mockReturnValueOnce(0.75).mockReturnValueOnce(0.25)
      .mockReturnValue(0.5)
    const child = sbxCrossover(right, left, 99)
    expect(child.genes[0].amplitude).toBeWithin(0.05, 0.8)
    expect(child.genes[0].frequency).toBeWithin(0.1, 5)
    expect(child.genes[0].phase).toBeWithin(0, Math.PI * 2)
    random.mockReturnValue(0.5)
    expect(sbxCrossover(left, right, -10).genes).toHaveLength(1)
  })

  it("clamps arithmetic blending at both bounds", () => {
    expect(arithmeticCrossover(left, right, -1).genes[0]).toMatchObject(right.genes[0])
    expect(arithmeticCrossover(left, right, 2).genes[0]).toMatchObject(left.genes[0])
  })

  it.each([uniformCrossover, arithmeticCrossover, sbxCrossover])("rejects mismatched parent shapes", crossover => {
    expect(() => crossover(left, createGenome({ genes: [] }))).toThrow(/same number of genes/)
  })
})

describe("fitness", () => {
  const zone = { x: 200, y: 500, width: 100, height: 80 }

  it("scores distance, proximity, target, death, and upright posture", () => {
    const creature = createCreature(0, { maxDistance: 150, currentPos: { x: 180, y: 550 } })
    const base = calculateFitness(creature, zone, 100)
    expect(base.distance).toBe(50)
    expect(base.targetBonus).toBeGreaterThan(0)
    creature.reachedTarget = true
    creature.isDead = true
    expect(calculateFitness(creature, zone, 100).total).toBe(550)
    creature.minHeadY = 300
    expect(calculateFitnessAdvanced(creature, zone, 100, 600).stability).toBe(25)
  })

  it("handles zero-distance targets, absent heads, and out-of-range proximity", () => {
    const creature = createCreature(0, {
      maxDistance: 90,
      currentPos: { x: -1000, y: 600 },
      particles: [],
    })
    const zeroRangeZone = { x: 100, y: 500, width: 100, height: 80 }
    expect(calculateFitness(creature, zeroRangeZone, 100).targetBonus).toBe(0)
    expect(calculateFitnessAdvanced(creature, zeroRangeZone, 100, 600).stability).toBe(0)

    const nearby = createCreature(0, { currentPos: { x: 250, y: 550 }, minHeadY: undefined })
    expect(calculateFitnessAdvanced(nearby, zone, 100, 600).targetBonus).toBe(500)
    expect(calculateFitnessAdvanced(nearby, zone, 100, 600).stability).toBeGreaterThan(0)
  })
})

expect.extend({
  toBeWithin(received: number, floor: number, ceiling: number) {
    const pass = received >= floor && received <= ceiling
    return { pass, message: () => `expected ${received} to be within ${floor}..${ceiling}` }
  },
})

declare module "vitest" {
  interface Assertion<T = any> { toBeWithin(floor: number, ceiling: number): T }
}
