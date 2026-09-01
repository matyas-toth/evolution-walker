import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
  applyAirResistance,
  integrateVerlet,
  createParticleMap,
  updateMuscles,
  satisfyConstraints,
  handleGroundCollision,
  handleWallCollision,
  checkTargetZone,
  checkCreatureTargetZone,
  checkHeadGroundAndKill,
  stepPhysics,
} from "@/core/physics"
import { createCreature, createParticle } from "../fixtures/training"

describe("Verlet integration", () => {
  it("integrates velocity and mass-scaled force", () => {
    const particle = createParticle({ pos: { x: 2, y: 3 }, oldPos: { x: 1, y: 1 }, mass: 2 })
    integrateVerlet([particle], { x: 4, y: 2 }, 0.5)
    expect(particle.pos).toEqual({ x: 3.5, y: 5.25 })
    expect(particle.oldPos).toEqual({ x: 2, y: 3 })
    expect(particle.velocity).toEqual({ x: 2, y: 4 })
  })

  it("does not move locked particles", () => {
    const particle = createParticle({ isLocked: true })
    const before = structuredClone(particle)
    integrateVerlet([particle], { x: 100, y: 100 }, 1)
    applyAirResistance([particle], 0.5)
    expect(particle).toEqual(before)
  })

  it("damps velocity for all finite coefficients", () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 1, noNaN: true }), coefficient => {
      const particle = createParticle({ pos: { x: 10, y: 10 }, oldPos: { x: 0, y: 0 } })
      applyAirResistance([particle], coefficient)
      expect(particle.velocity.x).toBeCloseTo(10 * (1 - coefficient))
    }))
  })
})

describe("constraints and muscles", () => {
  it("indexes particles and updates oscillator length", () => {
    const creature = createCreature()
    expect(createParticleMap(creature.particles).get("head")).toBe(creature.particles[0])
    creature.muscles[0].amplitude = 0.5
    creature.muscles[0].frequency = 1
    updateMuscles(creature.muscles, 0.25)
    expect(creature.muscles[0].currentLength).toBeCloseTo(creature.muscles[0].baseLength * 1.5)
  })

  it("moves unlocked particles toward the requested distance", () => {
    const p1 = createParticle({ id: "a", pos: { x: 0, y: 0 }, oldPos: { x: 0, y: 0 } })
    const p2 = createParticle({ id: "b", pos: { x: 20, y: 0 }, oldPos: { x: 20, y: 0 } })
    const map = createParticleMap([p1, p2])
    satisfyConstraints([{ id: "c", p1Id: "a", p2Id: "b", restLength: 10, stiffness: 1, damping: 0 }], map, 1)
    expect(p2.pos.x - p1.pos.x).toBeCloseTo(10)
  })

  it("honors locked particles and ignores missing references", () => {
    const locked = createParticle({ id: "a", isLocked: true, pos: { x: 0, y: 0 } })
    const free = createParticle({ id: "b", pos: { x: 20, y: 0 } })
    satisfyConstraints([
      { id: "valid", p1Id: "a", p2Id: "b", restLength: 10, stiffness: 1, damping: 0 },
      { id: "missing", p1Id: "a", p2Id: "missing", restLength: 1, stiffness: 1, damping: 0 },
    ], createParticleMap([locked, free]), 1)
    expect(locked.pos.x).toBe(0)
    expect(free.pos.x).toBeLessThan(20)
  })
})

describe("collisions and target detection", () => {
  it("applies ground restitution and friction without penetration", () => {
    const falling = createParticle({ pos: { x: 10, y: 101 }, oldPos: { x: 8, y: 95 }, radius: 5 })
    handleGroundCollision([falling], { y: 100, friction: 0.5, restitution: 0.25 })
    expect(falling.pos.y).toBe(95)
    expect(falling.oldPos.x).toBe(9)
    expect(falling.oldPos.y).toBeGreaterThan(95)
  })

  it("preserves upward motion and ignores locked/non-colliding particles", () => {
    const rising = createParticle({ pos: { x: 0, y: 99 }, oldPos: { x: 0, y: 101 }, radius: 2 })
    const locked = createParticle({ isLocked: true, pos: { x: 0, y: 120 } })
    handleGroundCollision([rising, locked], { y: 100, friction: 0, restitution: 0 })
    expect(rising.oldPos.y).toBeGreaterThan(rising.pos.y)
    expect(locked.pos.y).toBe(120)
  })

  it("keeps particles inside walls", () => {
    const particle = createParticle({ pos: { x: -1, y: 0 }, oldPos: { x: 3, y: 0 }, radius: 2 })
    handleWallCollision([particle], [{ x: 0, normal: { x: 1, y: 0 } }])
    expect(particle.pos.x).toBe(2)
  })

  it("uses inclusive target boundaries for particles and creatures", () => {
    const zone = { x: 10, y: 20, width: 5, height: 5 }
    const particle = createParticle({ pos: { x: 10, y: 25 } })
    const creature = createCreature()
    creature.particles[0] = particle
    expect(checkTargetZone(particle, zone)).toBe(true)
    expect(checkCreatureTargetZone(creature, zone)).toBe(true)
    particle.pos.x = 9.999
    expect(checkTargetZone(particle, zone)).toBe(false)
  })

  it("kills only when a present head touches the ground", () => {
    const creature = createCreature()
    const head = creature.particles.find(particle => particle.isHead)!
    head.pos.y = 595
    checkHeadGroundAndKill(creature, 600)
    expect(creature.isDead).toBe(true)
    checkHeadGroundAndKill(creature, 600)
  })
})

describe("stepPhysics", () => {
  it("runs the TypeScript pipeline and supports skipping muscle updates", () => {
    const creature = createCreature()
    const originalLength = creature.muscles[0].currentLength
    stepPhysics(creature, { y: 600, friction: 0.7, restitution: 0.3 }, [], 1 / 60, {
      forceY: 200,
      time: 0.25,
      skipMuscleUpdate: true,
    })
    expect(creature.muscles[0].currentLength).toBe(originalLength)
    expect(creature.particles.every(particle => Number.isFinite(particle.pos.x))).toBe(true)
  })
})
