/**
 * Selection algorithms for evolutionary algorithm.
 * @module core/genetics/selection
 */

import { Creature } from '@/core/types';

/**
 * Tournament selection
 * Randomly selects k creatures and returns the best one
 * 
 * @param creatures Array of creatures to select from
 * @param tournamentSize Number of creatures in tournament (default: 3)
 * @returns Best creature from tournament
 */
export function tournamentSelection(
  creatures: Creature[],
  tournamentSize: number = 3
): Creature {
  if (creatures.length === 0) {
    throw new Error('Cannot select from empty creature array');
  }

  const tournament: Creature[] = [];

  for (let i = 0; i < tournamentSize; i++) {
    const randomIndex = Math.floor(Math.random() * creatures.length);
    tournament.push(creatures[randomIndex]);
  }

  return tournament.reduce((best, current) =>
    current.fitness.total > best.fitness.total ? current : best
  );
}

/**
 * Selects top N creatures as elites
 * These creatures are preserved unchanged in the next generation
 * 
 * @param creatures Array of creatures to select from
 * @param count Number of elites to select
 * @returns Array of elite creatures (sorted by fitness, descending)
 */
export function selectElites(
  creatures: Creature[],
  count: number
): Creature[] {
  if (creatures.length === 0) {
    return [];
  }

  return [...creatures]
    .sort((a, b) => b.fitness.total - a.fitness.total)
    .slice(0, Math.min(count, creatures.length));
}

/**
 * Selects parents from top percentage of creatures
 * Used as parent pool for crossover operations
 * 
 * @param creatures Array of creatures to select from
 * @param topPercent Top percentage to select (default: 0.5 = top 50%)
 * @returns Array of parent candidates (sorted by fitness, descending)
 */
export function selectParents(
  creatures: Creature[],
  topPercent: number = 0.5
): Creature[] {
  if (creatures.length === 0) {
    return [];
  }

  const sorted = [...creatures].sort(
    (a, b) => b.fitness.total - a.fitness.total
  );
  const topCount = Math.max(1, Math.floor(sorted.length * topPercent));
  return sorted.slice(0, topCount);
}

/**
 * Selects both elites and parents in a single sort operation
 * Optimized version that sorts the population once and extracts both groups
 * 
 * @param creatures Array of creatures to select from
 * @param elitismCount Number of elites to select
 * @param topPercent Top percentage to select as parents (default: 0.5 = top 50%)
 * @returns Object containing elites, parents, and sorted array
 */
export function selectElitesAndParents(
  creatures: Creature[],
  elitismCount: number,
  topPercent: number = 0.5
): { elites: Creature[]; parents: Creature[]; sorted: Creature[] } {
  if (creatures.length === 0) {
    return { elites: [], parents: [], sorted: [] };
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

  return { elites, parents, sorted };
}
