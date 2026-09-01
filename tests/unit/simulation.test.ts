import { describe, expect, it, vi } from "vitest"
import {
  applyGenomeToMuscles,
  calculateCenterOfMass,
  createCreatureFromTopology,
} from "@/core/simulation/creature"
import { createDefaultConfig } from "@/core/simulation/utils"
import { createGenome, createParticle, createTestTopology } from "../fixtures/training"

describe("simulation factories", () => {
  it("calculates a mass-weighted center and handles zero total mass", () => {
    expect(calculateCenterOfMass([
      createParticle({ pos: { x: 0, y: 0 }, mass: 1 }),
      createParticle({ pos: { x: 10, y: 20 }, mass: 3 }),
    ])).toEqual({ x: 7.5, y: 15 })
    expect(calculateCenterOfMass([createParticle({ mass: 0 })])).toEqual({ x: 0, y: 0 })
  })

  it("creates isolated runtime state and applies matching genes", () => {
    vi.spyOn(Date, "now").mockReturnValue(100)
    vi.spyOn(Math, "random").mockReturnValue(0.5)
    const topology = createTestTopology()
    const genome = createGenome({ genes: [{ muscleId: "muscle", amplitude: 0.7, frequency: 3, phase: 2 }] })
    const creature = createCreatureFromTopology(topology, genome, { x: 10, y: 20 })
    expect(creature.particles[0].pos).toEqual({ x: 10, y: 0 })
    expect(creature.muscles[0]).toMatchObject({ amplitude: 0.7, frequency: 3, phase: 2 })
    expect(creature.startPos).toEqual(creature.currentPos)
    creature.particles[0].pos.x = 999
    expect(topology.particles[0].initialPos.x).toBe(0)
  })

  it("falls back to an explicit head and ignores genes for unknown muscles", () => {
    const topology = createTestTopology()
    topology.particles.forEach(particle => { delete particle.isHead })
    const creature = createCreatureFromTopology(topology)
    expect(creature.particles.find(particle => particle.id === "head")?.isHead).toBe(true)
    const before = creature.muscles[0].amplitude
    applyGenomeToMuscles(creature.muscles, createGenome({ genes: [{ muscleId: "unknown", amplitude: 1, frequency: 1, phase: 1 }] }))
    expect(creature.muscles[0].amplitude).toBe(before)
  })

  it("uses server-safe default viewport dimensions", () => {
    const config = createDefaultConfig()
    expect(config.worldBounds).toEqual({ left: 0, right: 1920, top: 0, bottom: 1080 })
    expect(config.groundY).toBe(864)
    expect(config.targetZone.x).toBe(1344)
  })
})
