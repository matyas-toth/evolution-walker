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
  analyzeLocomotion,
  STICKMAN_TOPOLOGY,
} from "@/core/topology"
import { createAsymmetricTwoLegTopology } from "../fixtures/training"
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

describe("locomotion analysis", () => {
  function walker(legXs: number[]) {
    const topology = createTestTopology()
    topology.particles = [topology.particles[0], ...legXs.map((x, index) => ({
      id: `foot-${index}`, initialPos: { x, y: 0 }, mass: 1, radius: 5, isLocked: false,
    }))]
    topology.constraints = legXs.map((_, index) => ({
      id: `bone-${index}`, p1Id: "head", p2Id: `foot-${index}`, restLength: 30, stiffness: 0.9, damping: 0,
    }))
    topology.muscles = legXs.map((_, index) => ({
      id: `muscle-${index}`, p1Id: "head", p2Id: `foot-${index}`, baseLength: 30, stiffness: 0.9, damping: 0,
    }))
    return topology
  }

  it.each([1, 2, 4, 5])("detects %i ordered support groups", count => {
    const analysis = analyzeLocomotion(walker(Array.from({ length: count }, (_, index) => index * 40)))
    expect(analysis.supportGroups).toHaveLength(count)
    expect([...analysis.muscleGroups]).toEqual(Array.from({ length: count }, (_, index) => index))
  })

  it("groups multi-point feet and honors manual support/body overrides", () => {
    const topology = walker([-30, -24, 30])
    let analysis = analyzeLocomotion(topology)
    expect(analysis.supportGroups).toHaveLength(2)
    topology.particles[1].locomotionRole = "support"
    topology.particles[1].gaitGroup = 7
    topology.particles[2].locomotionRole = "support"
    topology.particles[2].gaitGroup = 7
    topology.particles[3].locomotionRole = "body"
    analysis = analyzeLocomotion(topology)
    expect(analysis.source).toBe("manual")
    expect(analysis.supportGroups).toEqual([[1, 2]])
  })

  it("falls back to the lowest unlocked point when no rigid leaf is available", () => {
    const topology = walker([0])
    topology.constraints = []
    topology.particles[0].locomotionRole = "body"
    topology.particles[1].locomotionRole = "body"
    const analysis = analyzeLocomotion(topology)
    expect(analysis.source).toBe("fallback")
    expect(analysis.supportGroups).toHaveLength(1)
  })

  it("assigns the stock stickman's leg muscles to opposing gait groups and leaves its core stabilising", () => {
    const analysis = analyzeLocomotion(STICKMAN_TOPOLOGY)
    expect(analysis.supportGroups.map(group => group.map(index => STICKMAN_TOPOLOGY.particles[index].id))).toEqual([
      ["l-foot"],
      ["r-foot"],
    ])
    expect([...analysis.muscleGroups]).toEqual([0, 1, 0, 1, -1, -1, -1, -1, -1, -1])
  })

  it("keeps manually marked asymmetric leg muscles in alternating gait groups", () => {
    const analysis = analyzeLocomotion(createAsymmetricTwoLegTopology())
    expect(analysis.source).toBe("manual")
    expect([...analysis.muscleGroups]).toEqual([0, 1, 0, 1])
    expect(analysis.warnings).toEqual([])
  })

  it("keeps muscles spanning competing manual support groups neutral", () => {
    const topology = createAsymmetricTwoLegTopology()
    topology.muscles.push({ id: "bridge", p1Id: "left-foot", p2Id: "right-foot", baseLength: 95, stiffness: 0.9, damping: 0 })
    const analysis = analyzeLocomotion(topology)
    expect(analysis.muscleGroups.at(-1)).toBe(-1)
    expect(analysis.warnings.at(-1)).toContain("competing support groups")
  })
})
