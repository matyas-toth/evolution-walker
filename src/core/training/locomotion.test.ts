import assert from "node:assert/strict"
import test from "node:test"
import type { Genome, LocomotionMetrics, Topology } from "../types"
// @ts-ignore Node's built-in type stripper requires an explicit TypeScript extension.
import { BehaviorArchive, calculateLocomotionMetrics, compileFunctionalAnatomy, rankPareto } from "./locomotion.ts"

const genome = (id: string): Genome => ({ id, generation: 1, createdAt: 0, genes: [] })

function asymmetricTopology(): Topology {
    return {
        id: "asymmetric", name: "Asymmetric hopper",
        particles: [
            { id: "core", initialPos: { x: 0, y: 0 }, mass: 2, radius: 5, isLocked: false, isHead: true },
            { id: "joint", initialPos: { x: 5, y: 20 }, mass: 1, radius: 4, isLocked: false },
            { id: "tip", initialPos: { x: 8, y: 40 }, mass: 1, radius: 4, isLocked: false },
        ],
        constraints: [
            { id: "c1", p1Id: "core", p2Id: "joint", restLength: 20, stiffness: 0.8, damping: 0 },
            { id: "c2", p1Id: "joint", p2Id: "tip", restLength: 20, stiffness: 0.8, damping: 0 },
        ],
        muscles: [{ id: "m", p1Id: "core", p2Id: "joint", baseLength: 20, stiffness: 0.8, damping: 0 }],
    }
}

test("anatomy inference is invariant under translation, scale, and particle-id renaming", () => {
    const original = asymmetricTopology()
    const transformed: Topology = {
        ...original,
        particles: original.particles.map((particle, index) => ({
            ...particle,
            id: `renamed-${index}`,
            initialPos: { x: particle.initialPos.x * 3 + 91, y: particle.initialPos.y * 3 - 17 },
        })),
        constraints: original.constraints.map((constraint, index) => ({
            ...constraint,
            p1Id: `renamed-${original.particles.findIndex((particle) => particle.id === constraint.p1Id)}`,
            p2Id: `renamed-${original.particles.findIndex((particle) => particle.id === constraint.p2Id)}`,
            restLength: constraint.restLength * 3,
            id: `constraint-${index}`,
        })),
        muscles: original.muscles.map((muscle) => ({ ...muscle, p1Id: "renamed-0", p2Id: "renamed-1", baseLength: muscle.baseLength * 3 })),
    }
    const left = compileFunctionalAnatomy(original)
    const right = compileFunctionalAnatomy(transformed)
    assert.deepEqual(Array.from(left.coreIndices), Array.from(right.coreIndices))
    assert.deepEqual(Array.from(left.particleGroup), Array.from(right.particleGroup))
    assert.deepEqual(Array.from(left.muscleGroup), Array.from(right.muscleGroup))
})

test("one-effector morphology receives full contact utilization", () => {
    const metrics = calculateLocomotionMetrics({
        progress: 1, sustainedProgress: 0.5, survivalRatio: 1,
        stanceSteps: [30], strikeCounts: [5], intervalMeans: [12], intervalM2: [1],
        stanceSlip: 0, protectedClearRatio: 1, coreHeightRatio: 1,
        landingImpactRms: 0, verticalJerkRms: 0, actuatorWork: 10,
        airborneRatio: 0.5, pairedOpposition: -1, pairedBalance: -1, totalMass: 2, bodyScale: 20,
    })
    assert.equal(metrics.contactUtilization, 100)
    assert.equal(metrics.coordination, -1)
})

test("constrained Pareto selection demotes short-lived solutions", () => {
    const base: LocomotionMetrics = {
        progress: 1, sustainedProgress: 1, locomotionQuality: 60, contactUtilization: 60,
        periodicity: 60, coordination: 60, traction: 60, carriage: 60, smoothness: 60,
        energyEfficiency: 60, transportCost: 1, airborneRatio: 0.2, survivalRatio: 1,
        descriptor: [0.5, 0.2, 0.5],
    }
    const invalid = { ...base, progress: 100, survivalRatio: 0.1 }
    assert.equal(rankPareto([invalid, base]).order[0], 1)
})

test("MAP-Elites replacement is bounded and lexicographic", () => {
    const archive = new BehaviorArchive()
    const base: LocomotionMetrics = {
        progress: 1, sustainedProgress: 1, locomotionQuality: 50, contactUtilization: 50,
        periodicity: 50, coordination: 50, traction: 50, carriage: 50, smoothness: 50,
        energyEfficiency: 50, transportCost: 2, airborneRatio: 0.5, survivalRatio: 1,
        descriptor: [0.5, 0.5, 0.5],
    }
    archive.consider(base, () => genome("first"))
    archive.consider({ ...base, locomotionQuality: 70 }, () => genome("better"))
    archive.consider({ ...base, progress: 0.5, locomotionQuality: 100 }, () => genome("worse-progress"))
    assert.equal(archive.export().elites.length, 1)
    assert.equal(archive.export().elites[0].genome.id, "better")
    assert.ok(archive.coverage() <= 1)
})
