/**
 * Creature factory functions for creating creatures from topology.
 * @module core/simulation/creature
 */

import {
  Topology,
  Particle,
  Constraint,
  Muscle,
  Creature,
  Genome,
  FitnessScore,
  Vector2D,
} from '@/core/types';
import { add } from '@/utils/math';

/**
 * Calculates the center of mass for a set of particles
 * @param particles Array of particles
 * @returns Center of mass position
 */
export function calculateCenterOfMass(particles: Particle[]): Vector2D {
  let totalMass = 0;
  let weightedX = 0;
  let weightedY = 0;
  
  particles.forEach((particle) => {
    totalMass += particle.mass;
    weightedX += particle.pos.x * particle.mass;
    weightedY += particle.pos.y * particle.mass;
  });
  
  if (totalMass === 0) {
    return { x: 0, y: 0 };
  }
  
  return {
    x: weightedX / totalMass,
    y: weightedY / totalMass,
  };
}

/**
 * Applies genome gene values to muscle properties
 * Sets amplitude, frequency, and phase from MuscleGene
 * @param muscles Array of muscles to update
 * @param genome Genome containing gene values
 */
export function applyGenomeToMuscles(muscles: Muscle[], genome: Genome): void {
  const geneMap = new Map(genome.genes.map((gene) => [gene.muscleId, gene]));
  
  muscles.forEach((muscle) => {
    const gene = geneMap.get(muscle.id);
    if (gene) {
      muscle.amplitude = gene.amplitude;
      muscle.frequency = gene.frequency;
      muscle.phase = gene.phase;
      // Initialize currentLength to baseLength
      muscle.currentLength = muscle.baseLength;
    }
  });
}

/**
 * Creates a creature from a topology definition
 * Instantiates particles, constraints, and muscles from topology
 * 
 * @param topology Topology definition
 * @param genome Optional genome for muscle control (if not provided, muscles use default values)
 * @param spawnPos Optional spawn position offset (defaults to {x: 0, y: 0})
 * @returns Complete Creature object
 */
export function createCreatureFromTopology(
  topology: Topology,
  genome?: Genome,
  spawnPos: Vector2D = { x: 0, y: 0 }
): Creature {
  // Create particles from topology
  const particles: Particle[] = topology.particles.map((topoParticle) => {
    const initialPos = add(topoParticle.initialPos, spawnPos);
    return {
      id: topoParticle.id,
      pos: { ...initialPos },
      oldPos: { ...initialPos },
      mass: topoParticle.mass,
      radius: topoParticle.radius,
      isLocked: topoParticle.isLocked,
      friction: 0.1,
      velocity: { x: 0, y: 0 },
    };
  });

  const particleMap = new Map<string, Particle>();
  particles.forEach((p) => particleMap.set(p.id, p));
  
  // Create constraints from topology
  const constraints: Constraint[] = topology.constraints.map((topoConstraint) => ({
    id: topoConstraint.id,
    p1Id: topoConstraint.p1Id,
    p2Id: topoConstraint.p2Id,
    restLength: topoConstraint.restLength,
    stiffness: topoConstraint.stiffness,
    damping: topoConstraint.damping,
  }));
  
  // Create muscles from topology
  const muscles: Muscle[] = topology.muscles.map((topoMuscle) => ({
    id: topoMuscle.id,
    p1Id: topoMuscle.p1Id,
    p2Id: topoMuscle.p2Id,
    restLength: topoMuscle.baseLength,
    stiffness: topoMuscle.stiffness,
    damping: topoMuscle.damping,
    isMuscle: true,
    baseLength: topoMuscle.baseLength,
    amplitude: 0.2, // Default amplitude
    frequency: 1.0, // Default frequency (1 Hz)
    phase: 0, // Default phase
    currentLength: topoMuscle.baseLength,
  }));
  
  // Apply genome to muscles if provided
  if (genome) {
    applyGenomeToMuscles(muscles, genome);
  }
  
  // Calculate initial center of mass
  const centerOfMass = calculateCenterOfMass(particles);
  
  // Create default genome if not provided
  const defaultGenome: Genome = genome || {
    id: `genome-default-${Date.now()}`,
    genes: [],
    generation: 0,
    createdAt: Date.now(),
  };
  
  // Initialize fitness score
  const fitness: FitnessScore = {
    total: 0,
    distance: 0,
    targetBonus: 0,
    efficiency: 0,
    stability: 0,
  };
  
  return {
    id: `creature-${Date.now()}-${Math.random()}`,
    genome: defaultGenome,
    particles,
    particleMap,
    constraints,
    muscles,
    fitness,
    isDead: false,
    startPos: { ...centerOfMass },
    currentPos: { ...centerOfMass },
    maxDistance: centerOfMass.x,
    reachedTarget: false,
  };
}
