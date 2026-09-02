/**
 * Mutation functions for evolutionary algorithm.
 * @module core/genetics/mutation
 */

import { Genome } from '@/core/types';
import { wrapPhase } from '@/core/training/evolutionPolicy';

/**
 * Mutates a genome using Gaussian mutation
 * Each gene has a chance to mutate based on mutationRate
 * Mutation strength controls the magnitude of changes
 * 
 * @param genome Genome to mutate
 * @param mutationRate Probability of mutation per gene (0..1)
 * @param mutationStrength Magnitude of mutation (±%, default: 0.1 = ±10%)
 * @returns New mutated genome
 */
export function mutateGenome(
  genome: Genome,
  mutationRate: number,
  mutationStrength: number = 0.1
): Genome {
  const genes = genome.genes.map((gene) => {
    // Check if this gene should mutate
    if (Math.random() > mutationRate) {
      return gene; // No mutation
    }

    return {
      ...gene,
      amplitude: Math.max(0.05, Math.min(0.8, gene.amplitude + (Math.random() - 0.5) * 0.4 * mutationStrength)),
      frequency: Math.max(0.1, Math.min(5, gene.frequency + (Math.random() - 0.5) * 2 * mutationStrength)),
      phase: wrapPhase(gene.phase + (Math.random() - 0.5) * 2 * Math.PI * mutationStrength),
    };
  });

  return {
    ...genome,
    genes,
  };
}
