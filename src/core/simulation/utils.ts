/**
 * Simulation utility functions and default configurations.
 * @module core/simulation/utils
 */

import { SimulationConfig } from '@/core/types';

/**
 * Creates a default simulation configuration with sensible values
 * @returns Default SimulationConfig
 */
export function createDefaultConfig(): SimulationConfig {
  // Assume canvas is typically 1920x1080 or similar
  const canvasWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const canvasHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
  
  const groundY = canvasHeight * 0.8; // Ground at 80% of screen height
  const startX = canvasWidth * 0.1; // Start at 10% from left
  const targetX = canvasWidth * 0.7; // Target at 70% from left
  
  return {
    // Physics parameters
    gravity: { x: 0, y: 9.81 },
    airResistance: 0.02,
    groundFriction: 0.2,
    groundY,
    
    // Evolution parameters
    populationSize: 50,
    mutationRate: 0.05,
    mutationStrength: 0.1,
    crossoverRate: 0.7,
    elitismCount: 2,
    selectionPressure: 0.5,
    
    // Timing parameters
    durationSeconds: 10,
    timeStep: 1 / 60, // 60 Hz
    simSpeed: 1,
    
    // Target zone
    targetZone: {
      x: targetX,
      y: groundY - 100, // Above ground
      width: 100,
      height: 80,
    },
    
    // World boundaries
    worldBounds: {
      left: 0,
      right: canvasWidth,
      top: 0,
      bottom: canvasHeight,
    },
  };
}
