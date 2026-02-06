/**
 * Simulation-related type definitions for orchestration and state management.
 * @module core/types/simulation
 */

import { Vector2D } from './physics';
import { Creature } from './genetics';

/**
 * Simulation configuration
 * All parameters that control the simulation behavior
 */
export interface SimulationConfig {
  // Physics parameters
  /** Gravity vector (typically {x: 0, y: 9.81}) */
  gravity: Vector2D;
  
  /** Air resistance coefficient (0..1) */
  airResistance: number;
  
  /** Ground friction coefficient (0..1) */
  groundFriction: number;
  
  /** Ground level Y coordinate */
  groundY: number;
  
  // Evolution parameters
  /** Number of creatures per generation */
  populationSize: number;
  
  /** Probability of mutation (0..1) */
  mutationRate: number;
  
  /** Magnitude of mutation (±%) */
  mutationStrength: number;
  
  /** Probability of crossover (0..1) */
  crossoverRate: number;
  
  /** Number of elite creatures preserved unchanged */
  elitismCount: number;
  
  /** Top percentage selected as parents (0..1, e.g., 0.5 = top 50%) */
  selectionPressure: number;
  
  // Timing parameters
  /** Duration of each generation in seconds */
  durationSeconds: number;
  
  /** Physics timestep (typically 1/60 for 60Hz) */
  timeStep: number;
  
  /** Simulation speed multiplier (1x = real-time, 10x = 10x faster) */
  simSpeed: number;
  
  // Target zone
  /** Target zone definition */
  targetZone: {
    /** Left edge X coordinate */
    x: number;
    /** Top edge Y coordinate */
    y: number;
    /** Width */
    width: number;
    /** Height */
    height: number;
  };
  
  // World boundaries
  /** World boundaries */
  worldBounds: {
    /** Left boundary */
    left: number;
    /** Right boundary */
    right: number;
    /** Top boundary */
    top: number;
    /** Bottom boundary */
    bottom: number;
  };
}

/**
 * Current simulation state
 * Tracks the running state of the simulation
 */
export interface SimulationState {
  /** Current generation number */
  generation: number;
  
  /** Current time within generation (0..durationSeconds) */
  time: number;
  
  /** Array of all creatures in current generation */
  creatures: Creature[];
  
  /** Current configuration */
  config: SimulationConfig;
  
  /** Whether simulation is running */
  isRunning: boolean;
  
  /** Whether simulation is paused */
  isPaused: boolean;
  
  /** Best fitness score in current generation */
  bestFitness: number;
  
  /** Average fitness score in current generation */
  averageFitness: number;
  
  /** Simulation statistics */
  stats: {
    /** Total number of generations completed */
    totalGenerations: number;
    /** Total simulation time elapsed */
    totalTime: number;
    /** Total number of creatures evaluated */
    creaturesEvaluated: number;
  };
}

/**
 * Message sent from Worker to Main Thread
 * Lightweight update containing only rendering-necessary data
 */
export interface SimulationUpdate {
  /** Current generation number */
  generation: number;
  
  /** Current time within generation */
  time: number;
  
  /** Simplified creature data for rendering */
  creatures: {
    /** Creature ID */
    id: string;
    /** Particle positions only (minimal data for rendering) */
    particles: Vector2D[];
    /** Current fitness score */
    fitness: number;
    /** Visual color based on fitness */
    color: string;
  }[];
  
  /** Current statistics */
  stats: {
    /** Best fitness in current generation */
    bestFitness: number;
    /** Average fitness in current generation */
    averageFitness: number;
    /** Maximum distance reached by any creature */
    maxDistance: number;
  };
}
