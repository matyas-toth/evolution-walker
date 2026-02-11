/**
 * Physics module exports.
 * @module core/physics
 */

// Verlet integration
export {
  integrateVerlet,
  applyAirResistance,
} from './verlet';

// Constraint solver and muscles
export {
  satisfyConstraints,
  updateMuscles,
  createParticleMap,
} from './constraints';

// Collision detection
export {
  handleGroundCollision,
  handleWallCollision,
  checkTargetZone,
  checkCreatureTargetZone,
  checkHeadGroundAndKill,
} from './collisions';

// Unified step (WASM when available, TS fallback)
export { stepPhysics, type StepPhysicsOptions } from './stepPhysics';

// WASM glue (optional preload)
export { loadPhysicsWasm, isPhysicsWasmReady, isBatchWasmReady } from './wasmGlue';

// Batch WASM physics (all creatures in one call)
export { stepPhysicsBatch, type BatchPhysicsOptions } from './wasmBatchGlue';
