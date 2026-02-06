/**
 * Collision detection and response for physics simulation.
 * @module core/physics/collisions
 */

import { Particle, Ground, Wall, Creature } from '@/core/types';

/**
 * Handles ground collisions
 * Prevents particles from falling through the ground and applies friction
 * 
 * @param particles Array of particles to check
 * @param ground Ground definition with y coordinate, friction, and restitution
 * @returns Updated particles array with collision corrections applied
 */
export function handleGroundCollision(
  particles: Particle[],
  ground: Ground
): Particle[] {
  return particles.map((particle) => {
    if (particle.isLocked) return particle;
    
    if (particle.pos.y > ground.y - particle.radius) {
      // Collision detected
      const penetration = ground.y - particle.radius - particle.pos.y;
      
      // Correct position
      const newPos = {
        x: particle.pos.x,
        y: ground.y - particle.radius,
      };
      
      // Calculate velocity from position difference
      const velocity = {
        x: particle.pos.x - particle.oldPos.x,
        y: particle.pos.y - particle.oldPos.y,
      };
      
      // Apply friction to horizontal velocity
      const frictionForce = velocity.x * ground.friction;
      
      // Apply restitution (bounciness) to vertical velocity
      const newOldPos = {
        x: newPos.x - velocity.x + frictionForce,
        y: newPos.y - velocity.y * (1 - ground.restitution),
      };
      
      return {
        ...particle,
        pos: newPos,
        oldPos: newOldPos,
        velocity: {
          x: (newPos.x - newOldPos.x) / 0.016, // Approximate dt
          y: (newPos.y - newOldPos.y) / 0.016,
        },
      };
    }
    
    return particle;
  });
}

/**
 * Handles wall collisions
 * Prevents particles from passing through walls and reflects velocity
 * 
 * @param particles Array of particles to check
 * @param walls Array of wall definitions
 * @returns Updated particles array with collision corrections applied
 */
export function handleWallCollision(
  particles: Particle[],
  walls: Wall[]
): Particle[] {
  return particles.map((particle) => {
    if (particle.isLocked) return particle;
    
    walls.forEach((wall) => {
      // Simple AABB collision detection
      const distToWall = particle.pos.x - wall.x;
      const absDist = Math.abs(distToWall);
      
      // Check if particle is colliding with wall
      if (absDist < particle.radius && distToWall * wall.normal.x < 0) {
        // Collision detected
        // Correct position
        particle.pos.x = wall.x + wall.normal.x * particle.radius;
        
        // Reflect velocity
        const velocity = {
          x: particle.pos.x - particle.oldPos.x,
          y: particle.pos.y - particle.oldPos.y,
        };
        
        // Reflect horizontal velocity component
        particle.oldPos.x = particle.pos.x - velocity.x * 0.5;
      }
    });
    
    return particle;
  });
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
