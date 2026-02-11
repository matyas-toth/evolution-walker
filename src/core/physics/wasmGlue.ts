/**
 * WebAssembly glue for physics simulation.
 * Loads physics.wasm, syncs particle/constraint data to linear memory, runs the five WASM
 * functions (integrate_verlet, update_muscles, satisfy_constraints, ground_collision,
 * wall_collision), and syncs results back to JS creature objects.
 * @module core/physics/wasmGlue
 */

import type { Creature, Particle, Constraint, Muscle, Ground, Wall } from '@/core/types';

const PARTICLE_STRIDE = 72; // 9 f64 per particle
const CONSTRAINT_STRIDE = 80; // 10 f64 per constraint/muscle
const WALL_STRIDE = 24; // 3 f64 per wall

interface PhysicsWasmExports {
  memory: WebAssembly.Memory;
  integrate_verlet: (
    particlesOffset: number,
    numParticles: number,
    forceX: number,
    forceY: number,
    dt: number,
    airResistance: number
  ) => void;
  update_muscles: (constraintsOffset: number, numMuscles: number, time: number) => void;
  satisfy_constraints: (
    particlesOffset: number,
    constraintsOffset: number,
    numConstraints: number,
    iterations: number
  ) => void;
  ground_collision: (
    particlesOffset: number,
    numParticles: number,
    groundY: number,
    friction: number,
    restitution: number
  ) => void;
  wall_collision: (
    particlesOffset: number,
    numParticles: number,
    wallsOffset: number,
    numWalls: number
  ) => void;
  step_all_creatures: (
    creaturesOffset: number,
    numCreatures: number,
    numParticles: number,
    numConstraints: number,
    numMuscles: number,
    wallsOffset: number,
    numWalls: number,
    metadataOffset: number,
    groundY: number,
    groundFriction: number,
    groundRestitution: number,
    forceX: number,
    forceY: number,
    dt: number,
    airResistance: number,
    time: number,
    constraintIterations: number
  ) => void;
  post_step_creatures: (
    creaturesOffset: number,
    numCreatures: number,
    numParticles: number,
    numConstraints: number,
    metadataOffset: number,
    groundY: number
  ) => void;
}

let wasmModule: PhysicsWasmExports | null = null;

/**
 * Load and instantiate the physics WASM module. Call once (e.g. on app init or first step).
 * Safe to call from browser only; no-op on server.
 * @returns true if WASM is ready, false if load failed or not in browser
 */
export async function loadPhysicsWasm(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (wasmModule) return true;
  try {
    const res = await fetch('/physics.wasm');
    if (!res.ok) return false;
    const bytes = await res.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: {
        sin: (x: number) => Math.sin(x),
      },
    });
    const exports = instance.exports as unknown as PhysicsWasmExports;
    if (
      !exports.memory ||
      !exports.integrate_verlet ||
      !exports.update_muscles ||
      !exports.satisfy_constraints ||
      !exports.ground_collision ||
      !exports.wall_collision
    ) {
      return false;
    }
    wasmModule = exports;
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether the physics WASM module is loaded and ready.
 */
export function isPhysicsWasmReady(): boolean {
  return wasmModule !== null;
}

/**
 * Returns true if the WASM module has batch functions (step_all_creatures, post_step_creatures).
 * These are separate from the core physics functions to maintain backward compatibility.
 */
export function isBatchWasmReady(): boolean {
  return wasmModule !== null &&
    typeof wasmModule.step_all_creatures === 'function' &&
    typeof wasmModule.post_step_creatures === 'function';
}

/**
 * Returns the raw WASM module exports for batch operations.
 * Returns null if WASM is not loaded.
 */
export function getPhysicsWasmModule(): PhysicsWasmExports | null {
  return wasmModule;
}

export interface StepPhysicsWasmOptions {
  forceX?: number;
  forceY?: number;
  airResistance?: number;
  constraintIterations?: number;
  time?: number;
  skipMuscleUpdate?: boolean;
}

/**
 * Run one physics step in WASM: sync creature (and ground, walls) to linear memory,
 * call integrate_verlet, update_muscles, satisfy_constraints, ground_collision, wall_collision,
 * then sync particle positions/velocities back to the creature.
 * Requires loadPhysicsWasm() to have been called successfully.
 */
export function stepPhysicsWasm(
  creature: Creature,
  ground: Ground,
  walls: Wall[],
  dt: number,
  options: StepPhysicsWasmOptions = {}
): void {
  const mod = wasmModule;
  if (!mod) return;

  const {
    forceX = 0,
    forceY = 0,
    airResistance = 0,
    constraintIterations = 3,
    time = 0,
    skipMuscleUpdate = false,
  } = options;

  const particles = creature.particles;
  const constraints = creature.constraints;
  const muscles = creature.muscles;
  const allConstraints = [...constraints, ...muscles];
  const nParticles = particles.length;
  const nConstraints = constraints.length;
  const nMuscles = muscles.length;
  const nWalls = walls.length;

  const particleByteLen = nParticles * PARTICLE_STRIDE;
  const constraintByteLen = allConstraints.length * CONSTRAINT_STRIDE;
  const wallByteLen = nWalls * WALL_STRIDE;
  const totalBytes = particleByteLen + constraintByteLen + wallByteLen;

  const memory = mod.memory;
  const pageSize = 65536;
  const neededPages = Math.ceil(totalBytes / pageSize);
  if (memory.buffer.byteLength < totalBytes) {
    memory.grow(neededPages);
  }

  const view = new DataView(memory.buffer);
  const idToIndex = new Map<string, number>();
  particles.forEach((p, i) => idToIndex.set(p.id, i));

  // Sync particles to offset 0
  for (let i = 0; i < nParticles; i++) {
    const p = particles[i];
    const off = i * PARTICLE_STRIDE;
    view.setFloat64(off + 0, p.pos.x, true);
    view.setFloat64(off + 8, p.pos.y, true);
    view.setFloat64(off + 16, p.oldPos.x, true);
    view.setFloat64(off + 24, p.oldPos.y, true);
    view.setFloat64(off + 32, p.mass, true);
    view.setFloat64(off + 40, p.radius, true);
    view.setFloat64(off + 48, p.isLocked ? 1 : 0, true);
    view.setFloat64(off + 56, p.velocity.x, true);
    view.setFloat64(off + 64, p.velocity.y, true);
  }

  const constraintsOffset = particleByteLen;
  // Sync constraints then muscles (each slot: p1Index, p2Index, restLength, stiffness, currentLength, isMuscle, baseLength, amplitude, frequency, phase)
  for (let i = 0; i < allConstraints.length; i++) {
    const c = allConstraints[i];
    const isMuscle = 'isMuscle' in c && c.isMuscle;
    const p1Idx = idToIndex.get(c.p1Id) ?? 0;
    const p2Idx = idToIndex.get(c.p2Id) ?? 0;
    const off = constraintsOffset + i * CONSTRAINT_STRIDE;
    view.setFloat64(off + 0, p1Idx, true);
    view.setFloat64(off + 8, p2Idx, true);
    view.setFloat64(off + 16, c.restLength, true);
    view.setFloat64(off + 24, c.stiffness, true);
    view.setFloat64(off + 32, isMuscle ? (c as Muscle).currentLength : c.restLength, true);
    view.setFloat64(off + 40, isMuscle ? 1 : 0, true);
    view.setFloat64(off + 48, isMuscle ? (c as Muscle).baseLength : 0, true);
    view.setFloat64(off + 56, isMuscle ? (c as Muscle).amplitude : 0, true);
    view.setFloat64(off + 64, isMuscle ? (c as Muscle).frequency : 0, true);
    view.setFloat64(off + 72, isMuscle ? (c as Muscle).phase : 0, true);
  }

  const wallsOffset = constraintsOffset + constraintByteLen;
  for (let i = 0; i < nWalls; i++) {
    const w = walls[i];
    const off = wallsOffset + i * WALL_STRIDE;
    view.setFloat64(off + 0, w.x, true);
    view.setFloat64(off + 8, w.normal.x, true);
    view.setFloat64(off + 16, w.normal.y, true);
  }

  // Run WASM step: order matches TS (muscles, verlet, constraints, ground, walls)
  if (!skipMuscleUpdate) {
    mod.update_muscles(constraintsOffset + nConstraints * CONSTRAINT_STRIDE, nMuscles, time);
  }
  mod.integrate_verlet(0, nParticles, forceX, forceY, dt, airResistance);
  mod.satisfy_constraints(0, constraintsOffset, allConstraints.length, constraintIterations);
  mod.ground_collision(0, nParticles, ground.y, ground.friction, ground.restitution);
  mod.wall_collision(0, nParticles, wallsOffset, nWalls);

  // Sync back: particle pos, oldPos, velocity
  for (let i = 0; i < nParticles; i++) {
    const p = particles[i];
    const off = i * PARTICLE_STRIDE;
    p.pos.x = view.getFloat64(off + 0, true);
    p.pos.y = view.getFloat64(off + 8, true);
    p.oldPos.x = view.getFloat64(off + 16, true);
    p.oldPos.y = view.getFloat64(off + 24, true);
    p.velocity.x = view.getFloat64(off + 56, true);
    p.velocity.y = view.getFloat64(off + 64, true);
  }

  // Sync back muscle currentLength so JS has it for next frame if needed
  for (let i = 0; i < nMuscles; i++) {
    const off = constraintsOffset + (nConstraints + i) * CONSTRAINT_STRIDE + 32;
    muscles[i].currentLength = view.getFloat64(off, true);
  }
}
