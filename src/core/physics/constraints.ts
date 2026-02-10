/**
 * Constraint solver and muscle system for physics simulation.
 * @module core/physics/constraints
 */

import { Constraint, Muscle, Particle } from '@/core/types';
import { distance, subtract, normalize, scale } from '@/utils/math';

/**
 * Creates a Map for efficient particle lookup by ID
 * @param particles Array of particles
 * @returns Map<string, Particle>
 */
export function createParticleMap(particles: Particle[]): Map<string, Particle> {
  const map = new Map<string, Particle>();
  particles.forEach((particle) => {
    map.set(particle.id, particle);
  });
  return map;
}

/**
 * Updates muscle lengths based on oscillation
 * Calculates current target length based on sine wave oscillation
 * 
 * Formula: currentLength = baseLength * (1 + amplitude * sin(time * frequency * 2π + phase))
 * 
 * @param muscles Array of muscles to update
 * @param time Current simulation time
 */
export function updateMuscles(muscles: Muscle[], time: number): void {
  muscles.forEach((muscle) => {
    // Calculate oscillatory length
    const oscillation =
      muscle.amplitude *
      Math.sin(time * muscle.frequency * 2 * Math.PI + muscle.phase);
    muscle.currentLength = muscle.baseLength * (1 + oscillation);
  });
}

/**
 * Satisfies distance constraints (springs/bones)
 * Iteratively relaxes constraints to maintain rest lengths
 * 
 * Uses mass-weighted correction distribution for realistic behavior
 * 
 * @param constraints Array of constraints (can include both Constraint and Muscle)
 * @param particlesMap Map of particles by ID for efficient lookup
 * @param iterations Number of constraint relaxation iterations (default: 3)
 */
export function satisfyConstraints(
  constraints: (Constraint | Muscle)[],
  particlesMap: Map<string, Particle>,
  iterations: number = 3
): void {
  for (let i = 0; i < iterations; i++) {
    constraints.forEach((constraint) => {
      const p1 = particlesMap.get(constraint.p1Id);
      const p2 = particlesMap.get(constraint.p2Id);
      
      if (!p1 || !p2) return;
      
      // Calculate current distance
      const currentDist = distance(p1.pos, p2.pos);
      
      // Determine target length
      let targetLength = constraint.restLength;
      if ('isMuscle' in constraint && constraint.isMuscle) {
        // Muscle: dynamic length based on oscillation
        targetLength = constraint.currentLength;
      }
      
      // Calculate difference
      const diff = currentDist - targetLength;
      
      // Skip if constraint is satisfied (within tolerance)
      if (Math.abs(diff) < 0.01) return;
      
      // Calculate correction vector
      const direction = normalize(subtract(p2.pos, p1.pos));
      const correction = scale(direction, diff * constraint.stiffness);
      
      // Apply correction (distribute based on mass for realistic behavior)
      const totalMass = p1.mass + p2.mass;
      const p1Ratio = p2.mass / totalMass;
      const p2Ratio = p1.mass / totalMass;
      
      if (!p1.isLocked) {
        p1.pos.x += correction.x * p1Ratio;
        p1.pos.y += correction.y * p1Ratio;
      }
      if (!p2.isLocked) {
        p2.pos.x -= correction.x * p2Ratio;
        p2.pos.y -= correction.y * p2Ratio;
      }
    });
  }
}
