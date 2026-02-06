/**
 * Topology module exports.
 * @module core/topology
 */

// Pre-defined topologies
export { STICKMAN_TOPOLOGY } from './stickman';

// Validation functions
export {
  validateTopology,
  validateParticleIds,
  isConnected,
  hasMuscles,
  type ValidationResult,
} from './validation';

// Factory functions
export {
  createTopologyFromJSON,
  cloneTopology,
  offsetTopology,
} from './factory';

// Re-export topology types
export type {
  Topology,
  TopologyParticle,
  TopologyConstraint,
  TopologyMuscle,
} from '@/core/types/topology';
