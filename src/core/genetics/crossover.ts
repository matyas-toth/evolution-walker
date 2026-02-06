/**
 * Crossover (gene recombination) functions for evolutionary algorithm.
 * @module core/genetics/crossover
 */

import { Genome } from '@/core/types';

/**
 * Uniform crossover
 * Each gene has 50% chance from each parent
 * Creates offspring with mixed genes from both parents
 * 
 * @param parent1 First parent genome
 * @param parent2 Second parent genome
 * @returns New genome with mixed genes
 */
export function uniformCrossover(
  parent1: Genome,
  parent2: Genome
): Genome {
  if (parent1.genes.length !== parent2.genes.length) {
    throw new Error(
      'Parent genomes must have the same number of genes for crossover'
    );
  }

  const genes = parent1.genes.map((gene1, index) => {
    const gene2 = parent2.genes[index];

    if (!gene2) return gene1; // Fallback if mismatch

    // 50/50 chance for each parent's gene
    return Math.random() < 0.5 ? gene1 : gene2;
  });

  return {
    id: `genome-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    genes,
    generation: Math.max(parent1.generation, parent2.generation) + 1,
    parentIds: [parent1.id, parent2.id],
    createdAt: Date.now(),
  };
}

/**
 * Arithmetic crossover (blending)
 * Creates weighted average of parent genes
 * Produces smoother transitions between generations
 * 
 * @param parent1 First parent genome
 * @param parent2 Second parent genome
 * @param alpha Blending factor (0..1, default: 0.5 = equal blend)
 * @returns New genome with blended genes
 */
export function arithmeticCrossover(
  parent1: Genome,
  parent2: Genome,
  alpha: number = 0.5
): Genome {
  if (parent1.genes.length !== parent2.genes.length) {
    throw new Error(
      'Parent genomes must have the same number of genes for crossover'
    );
  }

  const clampedAlpha = Math.max(0, Math.min(1, alpha));

  const genes = parent1.genes.map((gene1, index) => {
    const gene2 = parent2.genes[index];

    if (!gene2) return gene1;

    return {
      muscleId: gene1.muscleId,
      amplitude:
        gene1.amplitude * clampedAlpha + gene2.amplitude * (1 - clampedAlpha),
      frequency:
        gene1.frequency * clampedAlpha + gene2.frequency * (1 - clampedAlpha),
      phase: gene1.phase * clampedAlpha + gene2.phase * (1 - clampedAlpha),
    };
  });

  return {
    id: `genome-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    genes,
    generation: Math.max(parent1.generation, parent2.generation) + 1,
    parentIds: [parent1.id, parent2.id],
    createdAt: Date.now(),
  };
}
