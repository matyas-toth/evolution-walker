/**
 * Verlet integration for particle motion simulation.
 * @module core/physics/verlet
 */

import { Particle, Vector2D } from '@/core/types';
import { subtract, add, multiply } from '@/utils/math';

/**
 * Applies air resistance/damping to particle velocities
 * @param particles Array of particles to apply damping to
 * @param coefficient Air resistance coefficient (0..1, where 0 = no damping, 1 = full stop)
 * @returns Updated particles array
 */
export function applyAirResistance(
  particles: Particle[],
  coefficient: number
): Particle[] {
  return particles.map((particle) => {
    if (particle.isLocked) return particle;
    
    const dampingFactor = 1 - coefficient;
    const velocity = subtract(particle.pos, particle.oldPos);
    const dampedVelocity = multiply(velocity, dampingFactor);
    
    return {
      ...particle,
      oldPos: subtract(particle.pos, dampedVelocity),
      velocity: dampedVelocity,
    };
  });
}

/**
 * Verlet integration step
 * Updates particle positions based on forces and previous positions
 * 
 * Formula: newPos = pos + (pos - oldPos) + acceleration * dt²
 * 
 * @param particles Array of particles to update
 * @param forces External forces (e.g., gravity)
 * @param dt Time step (typically 1/60 for 60Hz)
 * @param airResistance Optional air resistance coefficient (0..1)
 * @returns Updated particles array
 */
export function integrateVerlet(
  particles: Particle[],
  forces: Vector2D,
  dt: number,
  airResistance: number = 0
): Particle[] {
  let updatedParticles = particles.map((particle) => {
    if (particle.isLocked) return particle;
    
    // Compute velocity from position difference
    const velocity = subtract(particle.pos, particle.oldPos);
    
    // Compute acceleration from force
    const acceleration = {
      x: forces.x / particle.mass,
      y: forces.y / particle.mass,
    };
    
    // Update position using Verlet formula
    const newPos = {
      x: particle.pos.x + velocity.x + acceleration.x * dt * dt,
      y: particle.pos.y + velocity.y + acceleration.y * dt * dt,
    };
    
    return {
      ...particle,
      oldPos: particle.pos,
      pos: newPos,
      velocity: {
        x: velocity.x / dt,
        y: velocity.y / dt,
      },
    };
  });
  
  // Apply air resistance if specified
  if (airResistance > 0) {
    updatedParticles = applyAirResistance(updatedParticles, airResistance);
  }
  
  return updatedParticles;
}
