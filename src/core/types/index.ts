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
  TrainingHubConfig,
  ReplayPhase,
} from './simulation';

// Topology types
export type {
  Topology,
  TopologyParticle,
  TopologyConstraint,
  TopologyMuscle,
  LocomotionAnatomy,
  LocomotionContactGroup,
} from './topology';

export type {
  TrainingBackend,
  ActiveTrainingBackend,
  TrainingWorkerCount,
  TrainingEnginePhase,
  LocomotionCurriculumStage,
  LocomotionMetrics,
  QdArchiveElite,
  QdArchiveExport,
  TrainingStageTimings,
  TrainingDiagnostics,
  PackedRenderSnapshot,
  PackedTrainingReplay,
  TrainingSnapshot,
  TrainingEngineState,
  TrainingEngineConfig,
  TrainingCommand,
  TrainingEvent,
} from '../training/types';
