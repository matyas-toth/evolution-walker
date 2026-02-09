/**
 * Genetics module exports.
 * @module core/genetics
 */

// Population management
export {
  createRandomGenome,
  createInitialPopulation,
} from './population';

// Fitness calculation
export {
  calculateFitness,
  calculateFitnessAdvanced,
} from './fitness';

// Selection algorithms
export {
  tournamentSelection,
  selectElites,
  selectParents,
  selectElitesAndParents,
} from './selection';

// Crossover operations
export {
  uniformCrossover,
  arithmeticCrossover,
} from './crossover';

// Mutation
export {
  mutateGenome,
} from './mutation';

// Evolution Worker
export {
  EvolutionWorker,
  type EvolutionConfig,
  type EvolutionInput,
  type EvolutionOutput,
  type CreatureData,
} from './evolutionWorker';
