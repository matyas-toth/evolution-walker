import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  cloneTopology,
  createTopologyFromJSON,
  hasMuscles,
  isConnected,
  offsetTopology,
  validateParticleIds,
  validateTopology,
} from "@/core/topology"
import { createTestTopology } from "../fixtures/training"

describe("topology factories", () => {
  it("parses, deeply clones, and offsets a valid topology", () => {
    const topology = createTestTopology()
    expect(createTopologyFromJSON(structuredClone(topology))).toEqual(topology)
    const clone = cloneTopology(topology)
    clone.particles[0].initialPos.x = 999
    expect(topology.particles[0].initialPos.x).not.toBe(999)
    const shifted = offsetTopology(topology, { x: 4, y: -2 })
    expect(shifted.particles[0].initialPos).toEqual({ x: 4, y: -22 })
  })

  it.each([null, 4, {}, { id: 1 }, { id: "x", name: 4 }])("rejects malformed JSON: %j", value => {
    expect(() => createTopologyFromJSON(value)).toThrow()
  })

  it.each([
    { id: "x", name: "x" },
    { id: "x", name: "x", particles: [] },
    { id: "x", name: "x", particles: [], constraints: [] },
  ])("rejects missing topology collections", value => {
    expect(() => createTopologyFromJSON(value)).toThrow(/array/)
  })

  it("rejects structurally complete but invalid topology JSON", () => {
    const invalid = createTestTopology()
    invalid.constraints[0].p2Id = "missing"
    expect(() => createTopologyFromJSON(invalid)).toThrow(/Invalid topology/)
  })

  it("preserves every particle displacement for arbitrary finite offsets", () => {
    fc.assert(fc.property(
      fc.double({ min: -10_000, max: 10_000, noNaN: true }),
      fc.double({ min: -10_000, max: 10_000, noNaN: true }),
      (x, y) => {
        const topology = createTestTopology()
        const shifted = offsetTopology(topology, { x, y })
        shifted.particles.forEach((particle, index) => {
          expect(particle.initialPos.x).toBeCloseTo(topology.particles[index].initialPos.x + x)
          expect(particle.initialPos.y).toBeCloseTo(topology.particles[index].initialPos.y + y)
        })
      },
    ))
  })
})

describe("topology validation", () => {
  it("accepts a connected topology with muscles", () => {
    expect(validateTopology(createTestTopology())).toEqual({ isValid: true, errors: [], warnings: [] })
  })

  it("reports duplicate IDs, missing/self references, disconnected nodes, and invalid measurements", () => {
    const topology = createTestTopology()
    topology.id = ""
    topology.name = ""
    topology.particles.push({ ...topology.particles[0], mass: 0 })
    topology.constraints[0] = { ...topology.constraints[0], p2Id: "missing", restLength: 0 }
    topology.muscles[0] = { ...topology.muscles[0], p2Id: "head", baseLength: 0 }
    const result = validateTopology(topology)
    expect(result.isValid).toBe(false)
    expect(result.errors.join(" ")).toMatch(/non-empty id|Duplicate|non-existent|connects particle to itself|not connected/)
    expect(result.warnings.join(" ")).toMatch(/non-positive mass|rest length|base length/)
  })

  it("handles empty, singleton, disconnected, and muscle-free graphs", () => {
    const empty = { ...createTestTopology(), particles: [], constraints: [], muscles: [] }
    expect(isConnected(empty)).toBe(false)
    const singleton = { ...empty, particles: [createTestTopology().particles[0]] }
    expect(isConnected(singleton)).toBe(true)
    expect(hasMuscles(singleton)).toBe(false)
    expect(validateParticleIds(createTestTopology()).isValid).toBe(true)
  })
})
