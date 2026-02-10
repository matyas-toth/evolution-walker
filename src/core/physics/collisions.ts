/**
 * Collision detection and response for physics simulation.
 * @module core/physics/collisions
 */

import { Particle, Ground, Wall, Creature } from '@/core/types';

const PRESERVE_UPWARD_DAMP = 0.95; // slight decay to avoid runaway bounces
const APPROX_DT = 0.016;

/**
 * Handles ground collisions (in-place).
 * Prevents particles from falling through the ground and applies friction
 *
 * @param particles Array of particles to check (mutated in place)
 * @param ground Ground definition with y coordinate, friction, and restitution
 * @returns The same particles array (mutated in place)
 */
export function handleGroundCollision(
  particles: Particle[],
  ground: Ground
): Particle[] {
  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i];
    if (particle.isLocked) continue;
    if (particle.pos.y <= ground.y - particle.radius) continue;

    // Collision detected
    const newPosY = ground.y - particle.radius;
    const vx = particle.pos.x - particle.oldPos.x;
    const vy = particle.pos.y - particle.oldPos.y;
    const frictionForce = vx * ground.friction;
    const newOldPosY =
      vy < 0
        ? newPosY - vy * PRESERVE_UPWARD_DAMP
        : newPosY + vy * ground.restitution;
    const newOldPosX = particle.pos.x - vx + frictionForce;

    particle.pos.y = newPosY;
    particle.oldPos.x = newOldPosX;
    particle.oldPos.y = newOldPosY;
    particle.velocity.x = (particle.pos.x - particle.oldPos.x) / APPROX_DT;
    particle.velocity.y = (particle.pos.y - particle.oldPos.y) / APPROX_DT;
  }
  return particles;
}

/**
 * Handles wall collisions (in-place).
 * Prevents particles from passing through walls and reflects velocity
 *
 * @param particles Array of particles to check (mutated in place)
 * @param walls Array of wall definitions
 * @returns The same particles array (mutated in place)
 */
export function handleWallCollision(
  particles: Particle[],
  walls: Wall[]
): Particle[] {
  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i];
    if (particle.isLocked) continue;
    for (let w = 0; w < walls.length; w++) {
      const wall = walls[w];
      const distToWall = particle.pos.x - wall.x;
      const absDist = Math.abs(distToWall);
      if (absDist < particle.radius && distToWall * wall.normal.x < 0) {
        particle.pos.x = wall.x + wall.normal.x * particle.radius;
        const vx = particle.pos.x - particle.oldPos.x;
        particle.oldPos.x = particle.pos.x - vx * 0.5;
      }
    }
  }
  return particles;
}

/**
 * Checks if a particle is within the target zone
 * @param particle Particle to check
 * @param targetZone Target zone definition
 * @returns True if particle is within target zone bounds
 */
export function checkTargetZone(
  particle: Particle,
  targetZone: { x: number; y: number; width: number; height: number }
): boolean {
  return (
    particle.pos.x >= targetZone.x &&
    particle.pos.x <= targetZone.x + targetZone.width &&
    particle.pos.y >= targetZone.y &&
    particle.pos.y <= targetZone.y + targetZone.height
  );
}

/**
 * Checks if any particle of a creature has reached the target zone
 * @param creature Creature to check
 * @param targetZone Target zone definition
 * @returns True if any particle is within target zone
 */
export function checkCreatureTargetZone(
  creature: Creature,
  targetZone: { x: number; y: number; width: number; height: number }
): boolean {
  return creature.particles.some((particle) =>
    checkTargetZone(particle, targetZone)
  );
}

/**
 * If the creature's head particle touches or goes below ground, marks the creature as dead.
 * Call after handleGroundCollision. Uses particle id 'head' (e.g. stickman topology).
 *
 * @param creature Creature to check (mutated: isDead set to true if head touches ground)
 * @param groundY Ground Y coordinate
 */
export function checkHeadGroundAndKill(
  creature: Creature,
  groundY: number
): void {
  if (creature.isDead) return;
  const head = creature.particles.find((p) => p.id === 'head');
  if (!head) return;
  if (head.pos.y >= groundY - head.radius) {
    creature.isDead = true;
  }
}
