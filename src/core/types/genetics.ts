/**
 * Genetics-related type definitions for the evolutionary algorithm.
 * @module core/types/genetics
 */

import { Vector2D, Particle, Constraint, Muscle } from './physics';

/**
 * Single gene controlling one muscle
 * Defines the oscillatory behavior parameters for a specific muscle
 */
export interface MuscleGene {
  /** Links to Muscle.id in the topology */
  muscleId: string;
  
  /** Contraction amplitude (0..1) */
  amplitude: number;
  
  /** Oscillation frequency (Hz, typically 0.1..5.0) */
  frequency: number;
  
  /** Phase offset (radians, 0..2π) */
  phase: number;
}

/**
 * Complete genome (DNA of a creature)
 * Contains all genes that control muscle behavior
 */
export interface Genome {
  /** Unique identifier for the genome */
  id: string;
  
  /** Array of genes, one per muscle */
  genes: MuscleGene[];
  
  /** Generation number where this genome originated */
  generation: number;
  
  /** Optional IDs of parent genomes (for tracking lineage) */
  parentIds?: string[];
  
  /** Timestamp of creation */
  createdAt: number;
}

/**
 * Fitness score breakdown
 * Detailed fitness metrics for analysis and visualization
 */
export interface FitnessScore {
  /** Overall fitness (sum of all components) */
  total: number;
  
  /** Distance traveled component */
  distance: number;
  
  /** Bonus for reaching target zone */
  targetBonus: number;
  
  /** Energy efficiency (future: energy consumed per distance) */
  efficiency: number;
  
  /** Stability bonus (future: how stable the movement was) */
  stability: number;
}

/**
 * Complete creature entity
 * Combines physical structure with genetic information
 */
export interface Creature {
  /** Unique identifier for the creature */
  id: string;
  
  /** Genetic information (DNA) */
  genome: Genome;
  
  /** Physical particles (mass points) */
  particles: Particle[];
  
  /** Passive constraints (bones, rigid connections) */
  constraints: Constraint[];
  
  /** Active muscles (oscillatory constraints) */
  muscles: Muscle[];
  
  /** Current fitness score */
  fitness: FitnessScore;
  
  /** Whether the creature is dead (collision, out of bounds, etc.) */
  isDead: boolean;
  
  /** Starting position (center of mass) */
  startPos: Vector2D;
  
  /** Current position (center of mass) */
  currentPos: Vector2D;
  
  /** Maximum X coordinate reached */
  maxDistance: number;
  
  /** Whether the creature reached the target zone */
  reachedTarget: boolean;
}
