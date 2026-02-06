/**
 * Mutation functions for evolutionary algorithm.
 * @module core/genetics/mutation
 */

import { Genome } from '@/core/types';

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

    // Apply Gaussian mutation with bounds checking
    const mutateValue = (
      value: number,
      min: number,
      max: number
    ): number => {
      const change = (Math.random() - 0.5) * 2 * mutationStrength;
      const newValue = value * (1 + change);
      return Math.max(min, Math.min(max, newValue));
    };

    return {
      ...gene,
      amplitude: mutateValue(gene.amplitude, 0.05, 0.8),
      frequency: mutateValue(gene.frequency, 0.1, 5.0),
      phase: mutateValue(gene.phase, 0, Math.PI * 2),
    };
  });

  return {
    ...genome,
    genes,
  };
}
