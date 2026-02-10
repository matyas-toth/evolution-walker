/**
 * Unified physics step: runs either WASM or TS implementation.
 * One sync in, five operations (muscles, Verlet, constraints, ground, walls), one sync out when using WASM.
 * @module core/physics/stepPhysics
 */

import type { Creature, Ground, Wall } from '@/core/types';
import { integrateVerlet } from './verlet';
import { updateMuscles, satisfyConstraints } from './constraints';
import { handleGroundCollision, handleWallCollision } from './collisions';
import { isPhysicsWasmReady, stepPhysicsWasm } from './wasmGlue';

export interface StepPhysicsOptions {
  forceX?: number;
  forceY?: number;
  airResistance?: number;
  constraintIterations?: number;
  /** Simulation time (for muscle oscillation); default 0 */
  time?: number;
  /** When true, skip muscle oscillation (use currentLength from creature, e.g. for manual control) */
  skipMuscleUpdate?: boolean;
}

/**
 * Run one physics step: update muscles, Verlet integration, satisfy constraints,
 * ground collision, wall collision. Uses WASM when available, otherwise TS.
 */
export function stepPhysics(
  creature: Creature,
  ground: Ground,
  walls: Wall[],
  dt: number,
  options: StepPhysicsOptions = {}
): void {
  const {
    forceX = 0,
    forceY = 0,
    airResistance = 0,
    constraintIterations = 3,
    time = 0,
    skipMuscleUpdate = false,
  } = options;

  if (isPhysicsWasmReady()) {
    stepPhysicsWasm(creature, ground, walls, dt, {
      forceX,
      forceY,
      airResistance,
      constraintIterations,
      time,
      skipMuscleUpdate,
    });
    return;
  }

  // TS fallback: same order as WASM
  if (!skipMuscleUpdate) updateMuscles(creature.muscles, time);
  integrateVerlet(
    creature.particles,
    { x: forceX, y: forceY },
    dt,
    airResistance
  );
  satisfyConstraints(
    [...creature.constraints, ...creature.muscles],
    creature.particleMap,
    constraintIterations
  );
  handleGroundCollision(creature.particles, ground);
  handleWallCollision(creature.particles, walls);
}
