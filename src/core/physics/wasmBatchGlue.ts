/**
 * Batch WASM physics: sync all creatures to/from a single contiguous buffer,
 * step them all in one WASM call per timestep.
 * Eliminates per-creature JS↔WASM round-trips.
 * @module core/physics/wasmBatchGlue
 */

import type { Creature, Muscle, Ground, Wall } from '@/core/types';
import { getPhysicsWasmModule } from './wasmGlue';

const PARTICLE_STRIDE = 72;   // 9 f64 per particle
const CONSTRAINT_STRIDE = 80; // 10 f64 per constraint/muscle
const WALL_STRIDE = 24;       // 3 f64 per wall
const METADATA_STRIDE = 96;   // 12 f64 per creature metadata

export interface BatchPhysicsOptions {
    forceX: number;
    forceY: number;
    airResistance: number;
    constraintIterations: number;
    muscleStiffness: number;
}

interface BatchLayout {
    creaturesOffset: number;
    wallsOffset: number;
    metadataOffset: number;
    creatureStride: number;
    numParticles: number;
    numConstraintsTotal: number;
    numConstraintsOnly: number;
    numMuscles: number;
    totalBytes: number;
}

/**
 * Computes the flat memory layout for all creatures.
 */
function computeLayout(
    numCreatures: number,
    numParticles: number,
    numConstraintsOnly: number,
    numMuscles: number,
    numWalls: number
): BatchLayout {
    const numConstraintsTotal = numConstraintsOnly + numMuscles;
    const creatureStride = numParticles * PARTICLE_STRIDE + numConstraintsTotal * CONSTRAINT_STRIDE;
    const creaturesOffset = 0;
    const wallsOffset = creaturesOffset + numCreatures * creatureStride;
    const metadataOffset = wallsOffset + numWalls * WALL_STRIDE;
    const totalBytes = metadataOffset + numCreatures * METADATA_STRIDE;
    return {
        creaturesOffset,
        wallsOffset,
        metadataOffset,
        creatureStride,
        numParticles,
        numConstraintsTotal,
        numConstraintsOnly,
        numMuscles,
        totalBytes,
    };
}

/**
 * Sync all creature data (particles, constraints, muscles) + walls + metadata
 * into WASM linear memory. Call once before the multi-step loop.
 */
function syncToWasm(
    view: DataView,
    creatures: Creature[],
    walls: Wall[],
    targetZone: { x: number; y: number; width: number; height: number },
    layout: BatchLayout,
    idToIndex: Map<string, number>,
    headIdx: number,
    muscleStiffness: number
): void {
    const { creaturesOffset, wallsOffset, metadataOffset, creatureStride,
        numParticles, numConstraintsOnly, numMuscles } = layout;

    for (let c = 0; c < creatures.length; c++) {
        const creature = creatures[c];
        const baseOff = creaturesOffset + c * creatureStride;

        // Particles
        for (let i = 0; i < numParticles; i++) {
            const p = creature.particles[i];
            const off = baseOff + i * PARTICLE_STRIDE;
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

        // Constraints (passive bones first, then muscles)
        const constraintsOff = baseOff + numParticles * PARTICLE_STRIDE;
        const allConstraints = creature.constraints;
        for (let i = 0; i < numConstraintsOnly; i++) {
            const con = allConstraints[i];
            const p1Idx = idToIndex.get(con.p1Id) ?? 0;
            const p2Idx = idToIndex.get(con.p2Id) ?? 0;
            const off = constraintsOff + i * CONSTRAINT_STRIDE;
            view.setFloat64(off + 0, p1Idx, true);
            view.setFloat64(off + 8, p2Idx, true);
            view.setFloat64(off + 16, con.restLength, true);
            view.setFloat64(off + 24, con.stiffness, true);
            view.setFloat64(off + 32, con.restLength, true); // currentLength = restLength for bones
            view.setFloat64(off + 40, 0, true); // isMuscle = 0
            view.setFloat64(off + 48, 0, true);
            view.setFloat64(off + 56, 0, true);
            view.setFloat64(off + 64, 0, true);
            view.setFloat64(off + 72, 0, true);
        }

        // Muscles
        const muscles = creature.muscles;
        for (let i = 0; i < numMuscles; i++) {
            const m = muscles[i];
            const p1Idx = idToIndex.get(m.p1Id) ?? 0;
            const p2Idx = idToIndex.get(m.p2Id) ?? 0;
            const off = constraintsOff + (numConstraintsOnly + i) * CONSTRAINT_STRIDE;
            view.setFloat64(off + 0, p1Idx, true);
            view.setFloat64(off + 8, p2Idx, true);
            view.setFloat64(off + 16, m.restLength, true);
            view.setFloat64(off + 24, muscleStiffness, true);
            view.setFloat64(off + 32, m.currentLength, true);
            view.setFloat64(off + 40, 1, true); // isMuscle = 1
            view.setFloat64(off + 48, m.baseLength, true);
            view.setFloat64(off + 56, m.amplitude, true);
            view.setFloat64(off + 64, m.frequency, true);
            view.setFloat64(off + 72, m.phase, true);
        }

        // Metadata
        const metaOff = metadataOffset + c * METADATA_STRIDE;
        view.setFloat64(metaOff + 0, creature.isDead ? 1 : 0, true);
        view.setFloat64(metaOff + 8, headIdx, true);
        view.setFloat64(metaOff + 16, creature.startPos.x, true);
        view.setFloat64(metaOff + 24, creature.currentPos.x, true);
        view.setFloat64(metaOff + 32, creature.currentPos.y, true);
        view.setFloat64(metaOff + 40, creature.maxDistance, true);
        view.setFloat64(metaOff + 48, creature.minHeadY ?? creature.particles[headIdx].pos.y, true);
        view.setFloat64(metaOff + 56, creature.reachedTarget ? 1 : 0, true);
        view.setFloat64(metaOff + 64, targetZone.x, true);
        view.setFloat64(metaOff + 72, targetZone.y, true);
        view.setFloat64(metaOff + 80, targetZone.width, true);
        view.setFloat64(metaOff + 88, targetZone.height, true);
    }

    // Walls
    for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        const off = wallsOffset + i * WALL_STRIDE;
        view.setFloat64(off + 0, w.x, true);
        view.setFloat64(off + 8, w.normal.x, true);
        view.setFloat64(off + 16, w.normal.y, true);
    }
}

/**
 * Sync all creature data back from WASM linear memory.
 * Reads particles (pos, oldPos, velocity), muscle currentLength, and metadata.
 */
function syncFromWasm(
    view: DataView,
    creatures: Creature[],
    layout: BatchLayout,
    headIdx: number
): void {
    const { creaturesOffset, metadataOffset, creatureStride,
        numParticles, numConstraintsOnly, numMuscles } = layout;

    for (let c = 0; c < creatures.length; c++) {
        const creature = creatures[c];
        const baseOff = creaturesOffset + c * creatureStride;

        // Read metadata first (isDead may have changed)
        const metaOff = metadataOffset + c * METADATA_STRIDE;
        creature.isDead = view.getFloat64(metaOff + 0, true) !== 0;
        creature.currentPos.x = view.getFloat64(metaOff + 24, true);
        creature.currentPos.y = view.getFloat64(metaOff + 32, true);
        creature.maxDistance = view.getFloat64(metaOff + 40, true);
        creature.minHeadY = view.getFloat64(metaOff + 48, true);
        creature.reachedTarget = view.getFloat64(metaOff + 56, true) !== 0;

        // Particles: pos, oldPos, velocity
        for (let i = 0; i < numParticles; i++) {
            const p = creature.particles[i];
            const off = baseOff + i * PARTICLE_STRIDE;
            p.pos.x = view.getFloat64(off + 0, true);
            p.pos.y = view.getFloat64(off + 8, true);
            p.oldPos.x = view.getFloat64(off + 16, true);
            p.oldPos.y = view.getFloat64(off + 24, true);
            p.velocity.x = view.getFloat64(off + 56, true);
            p.velocity.y = view.getFloat64(off + 64, true);
        }

        // Muscles: currentLength
        const constraintsOff = baseOff + numParticles * PARTICLE_STRIDE;
        for (let i = 0; i < numMuscles; i++) {
            const off = constraintsOff + (numConstraintsOnly + i) * CONSTRAINT_STRIDE + 32;
            creature.muscles[i].currentLength = view.getFloat64(off, true);
        }
    }
}

/**
 * Run multiple physics timesteps for all creatures in a single batch.
 * One sync-in → N steps (2 WASM calls each) → one sync-out.
 *
 * @returns true if WASM batch was used, false if not available
 */
export function stepPhysicsBatch(
    creatures: Creature[],
    ground: Ground,
    walls: Wall[],
    targetZone: { x: number; y: number; width: number; height: number },
    numSteps: number,
    startTime: number,
    dt: number,
    options: BatchPhysicsOptions
): boolean {
    const mod = getPhysicsWasmModule();
    if (!mod || !mod.step_all_creatures || !mod.post_step_creatures ||
        creatures.length === 0 || numSteps <= 0) return false;

    try {
        const first = creatures[0];
        const numParticles = first.particles.length;
        const numConstraintsOnly = first.constraints.length;
        const numMuscles = first.muscles.length;
        const numCreatures = creatures.length;
        const numWalls = walls.length;

        // Compute memory layout
        const layout = computeLayout(numCreatures, numParticles, numConstraintsOnly, numMuscles, numWalls);

        // Ensure enough WASM memory
        const memory = mod.memory;
        const pageSize = 65536;
        if (memory.buffer.byteLength < layout.totalBytes) {
            const neededPages = Math.ceil(layout.totalBytes / pageSize) - (memory.buffer.byteLength / pageSize);
            if (neededPages > 0) memory.grow(neededPages);
        }

        // Build id-to-index map (shared across all creatures, same topology)
        const idToIndex = new Map<string, number>();
        first.particles.forEach((p, i) => idToIndex.set(p.id, i));
        const headIdx = first.particles.findIndex(p => p.id === 'head');

        // Sync all creatures to WASM (DataView created AFTER potential memory.grow)
        const view = new DataView(memory.buffer);
        syncToWasm(view, creatures, walls, targetZone, layout, idToIndex, headIdx, options.muscleStiffness);

        // Run N timesteps: 2 WASM calls per step (instead of 5000+)
        let time = startTime;
        for (let step = 0; step < numSteps; step++) {
            mod.step_all_creatures(
                layout.creaturesOffset,
                numCreatures,
                numParticles,
                layout.numConstraintsTotal,
                numMuscles,
                layout.wallsOffset,
                numWalls,
                layout.metadataOffset,
                ground.y, ground.friction, ground.restitution,
                options.forceX, options.forceY,
                dt, options.airResistance,
                time,
                options.constraintIterations
            );
            mod.post_step_creatures(
                layout.creaturesOffset,
                numCreatures,
                numParticles,
                layout.numConstraintsTotal,
                layout.metadataOffset,
                ground.y
            );
            time += dt;
        }

        // Sync all creatures back from WASM
        const viewOut = new DataView(memory.buffer);
        syncFromWasm(viewOut, creatures, layout, headIdx);

        return true;
    } catch (e) {
        console.error('[wasmBatchGlue] Batch physics failed, falling back to TS:', e);
        return false;
    }
}
