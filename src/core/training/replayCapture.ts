import type {
    ActiveTrainingBackend,
    Genome,
    PackedTrainingReplay,
    Topology,
    TrainingEngineConfig,
} from "@/core/types"
import type { TrainingBackendEngine } from "./engineBackend"
import {
    getTrainingTargetZone,
    TRAINING_FRAME_RATE,
    TRAINING_GROUND_Y,
    TRAINING_SPAWN_X,
    TRAINING_SPAWN_Y,
} from "./world"

/** Captures exact one-creature backend frames until the first target contact. */
export async function captureReplayFrames(
    engine: TrainingBackendEngine,
    topology: Topology,
    config: TrainingEngineConfig,
    genome: Genome,
    backend: ActiveTrainingBackend,
): Promise<PackedTrainingReplay> {
    const particleCount = topology.particles.length
    const maximumFrameCount = Math.max(2, Math.round(config.generationDuration * TRAINING_FRAME_RATE) + 1)
    const positions = new Float32Array(maximumFrameCount * particleCount * 2)
    const centers = new Float32Array(maximumFrameCount * 2)
    const targetZone = getTrainingTargetZone(config.targetDistance)
    let frameCount = 0
    let reachedFrame = -1

    const captureFrame = () => {
        const render = engine.getSnapshot("paused", true).render
        if (!render || render.creatureCount < 1 || render.particleCount !== particleCount) {
            throw new Error("Replay backend did not expose a complete creature frame")
        }
        const positionOffset = frameCount * particleCount * 2
        positions.set(render.positions.subarray(0, particleCount * 2), positionOffset)
        centers.set(render.centers.subarray(0, 2), frameCount * 2)
        for (let particle = 0; particle < particleCount; particle++) {
            const index = positionOffset + particle * 2
            const x = positions[index]
            const y = positions[index + 1]
            if (x >= targetZone.x && x <= targetZone.x + targetZone.width
                && y >= targetZone.y && y <= targetZone.y + targetZone.height) {
                reachedFrame = frameCount
                break
            }
        }
        frameCount++
    }

    let totalMass = 0
    let weightedX = 0
    let weightedY = 0
    for (let particle = 0; particle < particleCount; particle++) {
        const x = TRAINING_SPAWN_X + topology.particles[particle].initialPos.x
        const y = TRAINING_SPAWN_Y + topology.particles[particle].initialPos.y
        positions[particle * 2] = x
        positions[particle * 2 + 1] = y
        totalMass += topology.particles[particle].mass
        weightedX += x * topology.particles[particle].mass
        weightedY += y * topology.particles[particle].mass
        if (x >= targetZone.x && x <= targetZone.x + targetZone.width
            && y >= targetZone.y && y <= targetZone.y + targetZone.height) {
            reachedFrame = 0
        }
    }
    centers[0] = totalMass ? weightedX / totalMass : 0
    centers[1] = totalMass ? weightedY / totalMass : 0
    frameCount = 1
    while (reachedFrame < 0 && frameCount < maximumFrameCount) {
        await engine.runChunk(1, 50)
        captureFrame()
    }
    if (reachedFrame < 0) {
        throw new Error(`${backend} could not reproduce the target contact for the winning genome`)
    }

    return {
        backend,
        generation: genome.generation,
        frameRate: TRAINING_FRAME_RATE,
        frameCount,
        particleCount,
        reachedFrame,
        positions: positions.slice(0, frameCount * particleCount * 2),
        centers: centers.slice(0, frameCount * 2),
        groundY: TRAINING_GROUND_Y,
        targetZone,
    }
}
