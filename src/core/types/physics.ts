/**
 * Physics-related type definitions for the EvoWalker simulation engine.
 * @module core/types/physics
 */

/**
 * 2D vector representation
 */
export interface Vector2D {
  x: number;
  y: number;
}

/**
 * Particle (mass point) with Verlet integration data
 * Represents a single point mass in the physics simulation
 */
export interface Particle {
  /** Unique identifier for the particle */
  id: string;
  
  /** Current position */
  pos: Vector2D;
  
  /** Previous position (used for Verlet integration) */
  oldPos: Vector2D;
  
  /** Mass of the particle (affects inertia) */
  mass: number;
  
  /** Visual radius for rendering */
  radius: number;
  
  /** Whether the particle is locked (fixed in space) */
  isLocked: boolean;
  
  /** Ground friction coefficient (0..1) */
  friction: number;
  
  /** Computed velocity (derived from pos - oldPos) */
  velocity: Vector2D;
}

/**
 * Constraint (passive spring connecting two particles)
 * Represents a bone or rigid connection that maintains a rest length
 */
export interface Constraint {
  /** Unique identifier for the constraint */
  id: string;
  
  /** ID of the first particle */
  p1Id: string;
  
  /** ID of the second particle */
  p2Id: string;
  
  /** Natural rest length of the constraint */
  restLength: number;
  
  /** Stiffness coefficient (0..1, where 1 = rigid, <1 = springy) */
  stiffness: number;
  
  /** Damping coefficient (0..1, energy loss per frame) */
  damping: number;
}

/**
 * Muscle (active constraint with oscillatory behavior)
 * Extends Constraint with dynamic length changes controlled by a genome
 */
export interface Muscle extends Constraint {
  /** Type discriminator */
  isMuscle: true;
  
  /** Base rest length (before oscillation) */
  baseLength: number;
  
  /** Contraction amplitude (0..1, how much it contracts/expands) */
  amplitude: number;
  
  /** Oscillation frequency (Hz, speed of contraction) */
  frequency: number;
  
  /** Phase offset (radians, timing offset) */
  phase: number;
  
  /** Current target length (computed at runtime based on oscillation) */
  currentLength: number;
}

/**
 * Ground collision definition
 */
export interface Ground {
  /** Y coordinate of ground level */
  y: number;
  
  /** Friction coefficient (0..1) */
  friction: number;
  
  /** Restitution coefficient (0..1, bounciness, where 0 = no bounce, 1 = perfect bounce) */
  restitution: number;
}

/**
 * Wall collision definition
 */
export interface Wall {
  /** X coordinate of the wall */
  x: number;
  
  /** Normal vector pointing inward (away from wall) */
  normal: Vector2D;
}
