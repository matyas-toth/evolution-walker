/**
 * Crossover (gene recombination) functions for evolutionary algorithm.
 * @module core/genetics/crossover
 */

import { Genome } from '@/core/types';

/**
 * Uniform crossover (50/50 per gene).
 * Each gene is taken entirely from one parent at random.
 * Preserves building blocks (e.g. one parent's good leg, other's good shoulder).
 *
 * @param parent1 First parent genome
 * @param parent2 Second parent genome
 * @returns New genome with mixed genes
 */
export function uniformCrossover(
  parent1: Genome,
  parent2: Genome
): Genome {
  return uniformCrossoverWithBias(parent1, parent2, 0.5);
}

/**
 * Uniform crossover with fitter-parent bias (discrete "LEGO" crossover).
 * For each gene, take either parent's gene entirely (no blending).
 * Use probabilityFromParent1 to favor the fitter parent (e.g. 0.6 for 60% from fitter).
 *
 * @param parent1 First parent genome
 * @param parent2 Second parent genome
 * @param probabilityFromParent1 Probability (0..1) to take each gene from parent1 (e.g. 0.6 when parent1 is fitter)
 * @returns New genome with mixed genes
 */
export function uniformCrossoverWithBias(
  parent1: Genome,
  parent2: Genome,
  probabilityFromParent1: number
): Genome {
  if (parent1.genes.length !== parent2.genes.length) {
    throw new Error(
      'Parent genomes must have the same number of genes for crossover'
    );
  }

  const p = Math.max(0, Math.min(1, probabilityFromParent1));

  const genes = parent1.genes.map((gene1, index) => {
    const gene2 = parent2.genes[index];
    if (!gene2) return gene1;
    return Math.random() < p ? gene1 : gene2;
  });

  return {
    id: `genome-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    genes,
    generation: Math.max(parent1.generation, parent2.generation) + 1,
    parentIds: [parent1.id, parent2.id],
    createdAt: Date.now(),
  };
}

/** Gene bounds (aligned with mutation.ts) for SBX clipping */
const AMPLITUDE_MIN = 0.05;
const AMPLITUDE_MAX = 0.8;
const FREQUENCY_MIN = 0.1;
const FREQUENCY_MAX = 5.0;
const PHASE_MAX = Math.PI * 2;

/**
 * Simulated Binary Crossover (SBX) for continuous genes.
 * Offspring can lie outside the segment between parents (expansive), improving diversity
 * and reducing premature convergence. Standard in real-coded GAs (e.g. NSGA-II).
 *
 * @param parent1 First parent genome
 * @param parent2 Second parent genome
 * @param eta Distribution index (higher = offspring closer to parents). Typical 2–20; default 10.
 * @returns New genome with one child (per component randomly c1 or c2), clipped to gene bounds
 */
export function sbxCrossover(
  parent1: Genome,
  parent2: Genome,
  eta: number = 10
): Genome {
  if (parent1.genes.length !== parent2.genes.length) {
    throw new Error(
      'Parent genomes must have the same number of genes for crossover'
    );
  }

  const e = Math.max(1, Math.min(50, eta));
  const inv = 1 / (e + 1);

  function sbxOne(x1: number, x2: number): number {
    if (x1 > x2) [x1, x2] = [x2, x1];
    const u = Math.random();
    const beta =
      u <= 0.5
        ? Math.pow(2 * u, inv)
        : Math.pow(1 / (2 * (1 - u)), inv);
    const c1 = 0.5 * (x1 + x2 - beta * (x2 - x1));
    const c2 = 0.5 * (x1 + x2 + beta * (x2 - x1));
    return Math.random() < 0.5 ? c1 : c2;
  }

  function clip(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  const genes = parent1.genes.map((gene1, index) => {
    const gene2 = parent2.genes[index];
    if (!gene2) return gene1;
    return {
      muscleId: gene1.muscleId,
      amplitude: clip(
        sbxOne(gene1.amplitude, gene2.amplitude),
        AMPLITUDE_MIN,
        AMPLITUDE_MAX
      ),
      frequency: clip(
        sbxOne(gene1.frequency, gene2.frequency),
        FREQUENCY_MIN,
        FREQUENCY_MAX
      ),
      phase: clip(sbxOne(gene1.phase, gene2.phase), 0, PHASE_MAX),
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
