/**
 * Fitness calculation functions for evolutionary algorithm.
 * @module core/genetics/fitness
 */

import { Creature, FitnessScore } from '@/core/types';

/**
 * Calculates fitness score for a creature
 * Combines distance traveled, target zone bonus, and death penalty
 * 
 * @param creature Creature to evaluate
 * @param targetZone Target zone definition
 * @param startX Starting X position (for distance calculation)
 * @returns Fitness score breakdown
 */
export function calculateFitness(
  creature: Creature,
  targetZone: { x: number; y: number; width: number; height: number },
  startX: number
): FitnessScore {
  // Base fitness: distance traveled
  const distance = creature.maxDistance - startX;

  // Bonus for reaching target
  let targetBonus = 0;
  if (creature.reachedTarget) {
    targetBonus = 1000; // Large bonus for reaching target
  } else {
    // Partial bonus for getting close to target
    const targetCenterX = targetZone.x + targetZone.width / 2;
    const distanceToTarget = Math.abs(creature.currentPos.x - targetCenterX);
    const maxDistance = Math.abs(targetZone.x - startX);
    
    if (maxDistance > 0) {
      const proximityRatio = Math.max(0, 1 - distanceToTarget / maxDistance);
      targetBonus = proximityRatio * 500; // Up to 500 bonus for proximity
    }
  }

  // Penalty for falling/being dead
  const deathPenalty = creature.isDead ? -500 : 0;

  const total = distance + targetBonus + deathPenalty;

  return {
    total,
    distance,
    targetBonus,
    efficiency: 0, // Future: energy efficiency metric
    stability: 0, // Future: stability metric
  };
}

/** Weight for upright (head height) bonus; kept lower than distance so distance dominates */
const UPRIGHT_WEIGHT = 50;

/**
 * Advanced fitness: distance (primary) + upright bonus (secondary) + target + death penalty.
 * Uses creature.minHeadY when set (e.g. by advanced-learning) for upright; otherwise current head Y.
 *
 * @param creature Creature to evaluate
 * @param targetZone Target zone definition
 * @param startX Starting X position
 * @param groundY Ground Y coordinate (for upright normalization)
 * @returns Fitness score breakdown
 */
export function calculateFitnessAdvanced(
  creature: Creature,
  targetZone: { x: number; y: number; width: number; height: number },
  startX: number,
  groundY: number
): FitnessScore {
  const distance = creature.maxDistance - startX;

  let targetBonus = 0;
  if (creature.reachedTarget) {
    targetBonus = 1000;
  } else {
    const targetCenterX = targetZone.x + targetZone.width / 2;
    const distanceToTarget = Math.abs(creature.currentPos.x - targetCenterX);
    const maxDistance = Math.abs(targetZone.x - startX);
    if (maxDistance > 0) {
      const proximityRatio = Math.max(0, 1 - distanceToTarget / maxDistance);
      targetBonus = proximityRatio * 500;
    }
  }

  const deathPenalty = creature.isDead ? -500 : 0;

  const headY =
    creature.minHeadY ??
    creature.particles.find((p) => p.id === 'head')?.pos.y ??
    groundY;
  const uprightBonus =
    UPRIGHT_WEIGHT * Math.max(0, (groundY - headY) / groundY);

  const total = distance + uprightBonus + targetBonus + deathPenalty;

  return {
    total,
    distance,
    targetBonus,
    efficiency: 0,
    stability: uprightBonus,
  };
}
