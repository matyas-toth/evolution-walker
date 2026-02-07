/**
 * Population management functions for genetic algorithm.
 * @module core/genetics/population
 */

import { Genome, MuscleGene, Topology } from '@/core/types';

/**
 * Creates a random genome for a given topology
 * Generates random gene values for each muscle in the topology
 * 
 * @param topology Topology definition containing muscles
 * @param generation Generation number (default: 0)
 * @returns Random genome with unique ID
 */
export function createRandomGenome(
  topology: Topology,
  generation: number = 0 
): Genome {
  const genes: MuscleGene[] = topology.muscles.map((muscle) => ({
    muscleId: muscle.id,
    amplitude: Math.random() * 1 + 0.5, // 0.1..0.6
    frequency: Math.random() * 1 + 0.3, // 0.5..2.5 Hz
    phase: Math.random() * Math.PI * 2, // 0..2π
  }));

  return {
    id: `genome-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    genes,
    generation,
    createdAt: Date.now(),
  };
}

/**
 * Creates an initial population of random genomes
 * All genomes start at generation 0
 * 
 * @param topology Topology definition
 * @param size Number of genomes to create
 * @returns Array of random genomes
 */
export function createInitialPopulation(
  topology: Topology,
  size: number
): Genome[] {
  return Array.from({ length: size }, () => createRandomGenome(topology, 0));
}
