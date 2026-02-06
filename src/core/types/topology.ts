/**
 * Topology-related type definitions for creature structure definitions.
 * @module core/types/topology
 */

import { Vector2D } from './physics';

/**
 * Particle definition in topology
 * Describes a particle's initial state and properties
 */
export interface TopologyParticle {
  /** Unique identifier */
  id: string;
  
  /** Initial position relative to creature origin */
  initialPos: Vector2D;
  
  /** Mass of the particle */
  mass: number;
  
  /** Visual radius */
  radius: number;
  
  /** Whether the particle is locked (fixed) */
  isLocked: boolean;
}

/**
 * Constraint definition in topology
 * Describes a passive connection between two particles
 */
export interface TopologyConstraint {
  /** Unique identifier */
  id: string;
  
  /** ID of first particle */
  p1Id: string;
  
  /** ID of second particle */
  p2Id: string;
  
  /** Rest length of the constraint */
  restLength: number;
  
  /** Stiffness coefficient (0..1) */
  stiffness: number;
  
  /** Damping coefficient (0..1) */
  damping: number;
}

/**
 * Muscle definition in topology
 * Describes an active muscle connection between two particles
 */
export interface TopologyMuscle {
  /** Unique identifier */
  id: string;
  
  /** ID of first particle */
  p1Id: string;
  
  /** ID of second particle */
  p2Id: string;
  
  /** Base rest length (before oscillation) */
  baseLength: number;
  
  /** Stiffness coefficient (0..1) */
  stiffness: number;
  
  /** Damping coefficient (0..1) */
  damping: number;
}

/**
 * Topology definition (structure of creature)
 * Complete blueprint for a creature's physical structure
 */
export interface Topology {
  /** Unique identifier for the topology */
  id: string;
  
  /** Human-readable name */
  name: string;
  
  /** Array of particles */
  particles: TopologyParticle[];
  
  /** Array of passive constraints (bones) */
  constraints: TopologyConstraint[];
  
  /** Array of active muscles */
  muscles: TopologyMuscle[];
}
