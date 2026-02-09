/**
 * Web Worker for evolution calculations
 * Runs genetic algorithm operations off the main thread
 * @module core/genetics/evolution.worker
 */

import { Genome, FitnessScore } from '@/core/types';
import { tournamentSelection, arithmeticCrossover, mutateGenome } from './index';

// Worker-compatible creature type (minimal, just genome + fitness)
interface CreatureData {
  genome: Genome;
  fitness: FitnessScore;
}

// Evolution configuration
interface EvolutionConfig {
  elitismCount: number;
  parentsTopPercent: number;
  mutationRate: number;
  mutationStrength: number;
  populationSize: number;
  currentGeneration: number;
}

// Input message format
interface EvolutionInput {
  creatures: CreatureData[];
  config: EvolutionConfig;
}

// Output message format
interface EvolutionOutput {
  genomes: Genome[];
}

// Worker-compatible creature type for tournament selection
interface WorkerCreature {
  genome: Genome;
  fitness: FitnessScore;
}

/**
 * Tournament selection for worker creatures
 */
function workerTournamentSelection(
  creatures: WorkerCreature[],
  tournamentSize: number = 3
): WorkerCreature {
  if (creatures.length === 0) {
    throw new Error('Cannot select from empty creature array');
  }

  const tournament: WorkerCreature[] = [];

  for (let i = 0; i < tournamentSize; i++) {
    const randomIndex = Math.floor(Math.random() * creatures.length);
    tournament.push(creatures[randomIndex]);
  }

  return tournament.reduce((best, current) =>
    current.fitness.total > best.fitness.total ? current : best
  );
}

/**
 * Selects elites and parents in a single sort operation
 */
function selectElitesAndParents(
  creatures: WorkerCreature[],
  elitismCount: number,
  topPercent: number
): { elites: WorkerCreature[]; parents: WorkerCreature[] } {
  if (creatures.length === 0) {
    return { elites: [], parents: [] };
  }

  // Sort once by fitness descending
  const sorted = [...creatures].sort(
    (a, b) => b.fitness.total - a.fitness.total
  );

  // Extract elites (top N)
  const elites = sorted.slice(0, Math.min(elitismCount, sorted.length));

  // Extract parents (top percentage)
  const topCount = Math.max(1, Math.floor(sorted.length * topPercent));
  const parents = sorted.slice(0, topCount);

  return { elites, parents };
}

/**
 * Main evolution logic
 */
function evolveGeneration(input: EvolutionInput): EvolutionOutput {
  const { creatures, config } = input;
  const {
    elitismCount,
    parentsTopPercent,
    mutationRate,
    mutationStrength,
    populationSize,
    currentGeneration,
  } = config;

  // Convert to worker creatures
  const workerCreatures: WorkerCreature[] = creatures.map((c) => ({
    genome: c.genome,
    fitness: c.fitness,
  }));

  // Sort once and extract elites and parents
  const { elites, parents } = selectElitesAndParents(
    workerCreatures,
    elitismCount,
    parentsTopPercent
  );

  // Start with elite genomes
  const nextGenomes: Genome[] = elites.map((c) => c.genome);

  // Generate offspring until we reach population size
  while (nextGenomes.length < populationSize) {
    // Tournament selection for two parents
    const p1 = workerTournamentSelection(parents, 3);
    const p2 = workerTournamentSelection(parents, 3);

    // Crossover
    let offspring = arithmeticCrossover(p1.genome, p2.genome);

    // Mutation
    offspring = mutateGenome(offspring, mutationRate, mutationStrength);

    // Set generation
    offspring = { ...offspring, generation: currentGeneration + 1 };

    nextGenomes.push(offspring);
  }

  return { genomes: nextGenomes };
}

// Worker message handler
self.onmessage = (event: MessageEvent<EvolutionInput>) => {
  try {
    const input = event.data;
    const output = evolveGeneration(input);
    self.postMessage(output);
  } catch (error) {
    // Post error back to main thread
    self.postMessage({
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    });
  }
};

// Export types for TypeScript (not used at runtime)
export type { EvolutionInput, EvolutionOutput, EvolutionConfig };
