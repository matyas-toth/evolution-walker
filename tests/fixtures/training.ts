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
    mutationRate: 0.12,
    mutationStrength: 0.42,
    elitismCount: 1,
    parentsTopPercent: 0.5,
    targetDistance: 1_400,
    backgroundMode: false,
    simulationSpeed: 1,
    backend: "legacy",
    seed: 12345,
    workerCount: 1,
    snapshotHz: 5,
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
