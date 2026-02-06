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
} from './collisions';
