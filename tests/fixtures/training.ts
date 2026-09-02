import type {
  Creature,
  Genome,
  PackedTrainingReplay,
  Particle,
  Topology,
  TrainingEngineConfig,
} from "@/core/types"
import { createCreatureFromTopology } from "@/core/simulation/creature"

export function createTestTopology(): Topology {
  return {
    id: "test-walker",
    name: "Test Walker",
    particles: [
      { id: "head", initialPos: { x: 0, y: -20 }, mass: 1, radius: 5, isLocked: false, isHead: true },
      { id: "foot", initialPos: { x: 20, y: 0 }, mass: 1, radius: 5, isLocked: false },
    ],
    constraints: [
      { id: "bone", p1Id: "head", p2Id: "foot", restLength: Math.sqrt(800), stiffness: 0.9, damping: 0 },
    ],
    muscles: [
      { id: "muscle", p1Id: "head", p2Id: "foot", baseLength: Math.sqrt(800), stiffness: 0.9, damping: 0 },
    ],
  }
}

/** Regression fixture for the three-pixel asymmetric manually marked two-leg creature. */
export function createAsymmetricTwoLegTopology(): Topology {
  return {
    id: "asymmetric-two-leg",
    name: "Asymmetric Two Leg",
    particles: [
      { id: "head", initialPos: { x: 0, y: -190 }, mass: 1, radius: 7, isLocked: false, isHead: true, locomotionRole: "body" },
      { id: "hip", initialPos: { x: 0, y: -120 }, mass: 1, radius: 6, isLocked: false },
      { id: "right-foot", initialPos: { x: 52, y: -109 }, mass: 1, radius: 6, isLocked: false, locomotionRole: "support", gaitGroup: 2 },
      { id: "left-foot", initialPos: { x: -43, y: -113 }, mass: 1, radius: 6, isLocked: false, locomotionRole: "support", gaitGroup: 1 },
      { id: "left-knee", initialPos: { x: -41, y: -148 }, mass: 1, radius: 6, isLocked: false, locomotionRole: "support", gaitGroup: 1 },
      { id: "right-knee", initialPos: { x: 37, y: -151 }, mass: 1, radius: 6, isLocked: false, locomotionRole: "support", gaitGroup: 2 },
    ],
    constraints: [
      { id: "torso", p1Id: "head", p2Id: "hip", restLength: 70, stiffness: 0.9, damping: 0 },
      { id: "left-leg", p1Id: "left-knee", p2Id: "left-foot", restLength: 35, stiffness: 0.9, damping: 0 },
      { id: "right-leg", p1Id: "right-knee", p2Id: "right-foot", restLength: 42, stiffness: 0.9, damping: 0 },
    ],
    muscles: [
      { id: "left-foot-muscle", p1Id: "hip", p2Id: "left-foot", baseLength: 70, stiffness: 0.9, damping: 0 },
      { id: "right-foot-muscle", p1Id: "hip", p2Id: "right-foot", baseLength: 70, stiffness: 0.9, damping: 0 },
      { id: "left-knee-muscle", p1Id: "hip", p2Id: "left-knee", baseLength: 55, stiffness: 0.9, damping: 0 },
      { id: "right-knee-muscle", p1Id: "hip", p2Id: "right-knee", baseLength: 55, stiffness: 0.9, damping: 0 },
    ],
  }
}

export function createFourSupportTopology(): Topology {
  const feet = [-75, -25, 25, 75]
  return {
    id: "four-support",
    name: "Four Support Walker",
    particles: [
      { id: "head", initialPos: { x: 0, y: -80 }, mass: 1, radius: 6, isLocked: false, isHead: true, locomotionRole: "body" },
      { id: "body", initialPos: { x: 0, y: -45 }, mass: 2, radius: 7, isLocked: false, locomotionRole: "body" },
      ...feet.map((x, index) => ({ id: `foot-${index}`, initialPos: { x, y: 0 }, mass: 1, radius: 6, isLocked: false, locomotionRole: "support" as const, gaitGroup: index })),
    ],
    constraints: feet.map((x, index) => ({ id: `leg-${index}`, p1Id: "body", p2Id: `foot-${index}`, restLength: Math.hypot(x, 45), stiffness: 0.9, damping: 0 })),
    muscles: feet.map((x, index) => ({ id: `muscle-${index}`, p1Id: "body", p2Id: `foot-${index}`, baseLength: Math.hypot(x, 45), stiffness: 0.9, damping: 0 })),
  }
}

export function createGenome(overrides: Partial<Genome> = {}): Genome {
  return {
    id: "genome-test",
    generation: 1,
    createdAt: 1_700_000_000_000,
    genes: [{ muscleId: "muscle", amplitude: 0.2, frequency: 1, phase: 0 }],
    ...overrides,
  }
}

export function createParticle(overrides: Partial<Particle> = {}): Particle {
  return {
    id: "particle",
    pos: { x: 10, y: 10 },
    oldPos: { x: 9, y: 9 },
    velocity: { x: 0, y: 0 },
    mass: 1,
    radius: 2,
    isLocked: false,
    friction: 0.1,
    ...overrides,
  }
}

export function createCreature(fitness = 0, overrides: Partial<Creature> = {}): Creature {
  const creature = createCreatureFromTopology(createTestTopology(), createGenome(), { x: 100, y: 570 })
  creature.fitness.total = fitness
  return Object.assign(creature, overrides)
}

export function createTrainingConfig(overrides: Partial<TrainingEngineConfig> = {}): TrainingEngineConfig {
  return {
    populationSize: 8,
    generationDuration: 0.1,
    mutationRate: 0.15,
    mutationStrength: 0.28,
    elitismCount: 1,
    parentsTopPercent: 0.5,
    targetDistance: 1_400,
    backgroundMode: false,
    simulationSpeed: 1,
    backend: "legacy",
    seed: 12345,
    workerCount: 1,
    snapshotHz: 5,
    evolutionPolicyVersion: 3,
    ...overrides,
  }
}

export function createReplay(overrides: Partial<PackedTrainingReplay> = {}): PackedTrainingReplay {
  return {
    backend: "legacy",
    generation: 4,
    frameRate: 60,
    frameCount: 3,
    particleCount: 2,
    reachedFrame: 2,
    positions: new Float32Array([
      100, 550, 120, 570,
      150, 550, 170, 570,
      200, 520, 220, 570,
    ]),
    centers: new Float32Array([110, 560, 160, 560, 210, 545]),
    groundY: 600,
    targetZone: { x: 200, y: 500, width: 100, height: 80 },
    ...overrides,
  }
}
