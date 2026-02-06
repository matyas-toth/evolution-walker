/**
 * Unified type exports for the EvoWalker core module.
 * @module core/types
 */

// Physics types
export type {
  Vector2D,
  Particle,
  Constraint,
  Muscle,
  Ground,
  Wall,
} from './physics';

// Genetics types
export type {
  MuscleGene,
  Genome,
  FitnessScore,
  Creature,
} from './genetics';

// Simulation types
export type {
  SimulationConfig,
  SimulationState,
  SimulationUpdate,
} from './simulation';

// Topology types
export type {
  Topology,
  TopologyParticle,
  TopologyConstraint,
  TopologyMuscle,
} from './topology';
