/**
 * Verlet integration for particle motion simulation.
 * @module core/physics/verlet
 */

import { Particle, Vector2D } from '@/core/types';

/**
 * Applies air resistance/damping to particle velocities (in-place).
 * @param particles Array of particles to apply damping to
 * @param coefficient Air resistance coefficient (0..1, where 0 = no damping, 1 = full stop)
 * @returns The same particles array (mutated in place)
 */
export function applyAirResistance(
  particles: Particle[],
  coefficient: number
): Particle[] {
  const dampingFactor = 1 - coefficient;
  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i];
    if (particle.isLocked) continue;
    const vx = particle.pos.x - particle.oldPos.x;
    const vy = particle.pos.y - particle.oldPos.y;
    const dampedVx = vx * dampingFactor;
    const dampedVy = vy * dampingFactor;
    particle.oldPos.x = particle.pos.x - dampedVx;
    particle.oldPos.y = particle.pos.y - dampedVy;
    particle.velocity.x = dampedVx;
    particle.velocity.y = dampedVy;
  }
  return particles;
}

/**
 * Verlet integration step (in-place).
 * Updates particle positions based on forces and previous positions
 *
 * Formula: newPos = pos + (pos - oldPos) + acceleration * dt²
 *
 * @param particles Array of particles to update (mutated in place)
 * @param forces External forces (e.g., gravity)
 * @param dt Time step (typically 1/60 for 60Hz)
 * @param airResistance Optional air resistance coefficient (0..1)
 * @returns The same particles array (mutated in place)
 */
export function integrateVerlet(
  particles: Particle[],
  forces: Vector2D,
  dt: number,
  airResistance: number = 0
): Particle[] {
  const dtSq = dt * dt;
  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i];
    if (particle.isLocked) continue;

    const vx = particle.pos.x - particle.oldPos.x;
    const vy = particle.pos.y - particle.oldPos.y;
    const ax = forces.x / particle.mass;
    const ay = forces.y / particle.mass;

    const newPosX = particle.pos.x + vx + ax * dtSq;
    const newPosY = particle.pos.y + vy + ay * dtSq;

    particle.oldPos.x = particle.pos.x;
    particle.oldPos.y = particle.pos.y;
    particle.pos.x = newPosX;
    particle.pos.y = newPosY;
    particle.velocity.x = vx / dt;
    particle.velocity.y = vy / dt;
  }

  if (airResistance > 0) {
    applyAirResistance(particles, airResistance);
  }

  return particles;
}
