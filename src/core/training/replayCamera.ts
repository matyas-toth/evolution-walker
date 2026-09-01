import type { PackedTrainingReplay, Topology } from "@/core/types"

export interface ReplayCourseBounds {
    minX: number
    maxX: number
    minY: number
    maxY: number
}

export interface FixedReplayCamera {
    bounds: ReplayCourseBounds
    cameraCenterX: number
    groundVisualY: number
    horizontalPadding: number
    scale: number
}

/** Computes one immutable camera for the complete replay trajectory and target. */
export function calculateFixedReplayCamera(
    replay: PackedTrainingReplay,
    topology: Topology,
    viewport: { width: number; height: number },
): FixedReplayCamera | null {
    if (viewport.width <= 0 || viewport.height <= 0) return null

    const zone = replay.targetZone
    const particleRadius = topology.particles.reduce(
        (largest, particle) => Math.max(largest, particle.radius ?? 4),
        4,
    )
    const bounds: ReplayCourseBounds = {
        minX: zone.x,
        maxX: zone.x + zone.width,
        minY: Math.min(zone.y, replay.groundY),
        maxY: Math.max(zone.y + zone.height, replay.groundY),
    }

    for (let offset = 0; offset < replay.positions.length; offset += 2) {
        const x = replay.positions[offset]
        const y = replay.positions[offset + 1]
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue
        bounds.minX = Math.min(bounds.minX, x - particleRadius)
        bounds.maxX = Math.max(bounds.maxX, x + particleRadius)
        bounds.minY = Math.min(bounds.minY, y - particleRadius)
        bounds.maxY = Math.max(bounds.maxY, y + particleRadius)
    }

    const horizontalSpan = Math.max(1, bounds.maxX - bounds.minX)
    const horizontalPadding = Math.max(36, horizontalSpan * 0.06)
    const groundVisualY = viewport.height * 0.82
    const horizontalScale = (viewport.width - 28) / (horizontalSpan + horizontalPadding * 2)
    const distanceAboveGround = Math.max(1, replay.groundY - bounds.minY)
    const verticalScaleAbove = (groundVisualY - 22) / (distanceAboveGround * 1.1)
    const distanceBelowGround = Math.max(0, bounds.maxY - replay.groundY)
    const verticalScaleBelow = distanceBelowGround > 0
        ? (viewport.height - groundVisualY - 10) / (distanceBelowGround * 1.1)
        : Number.POSITIVE_INFINITY

    return {
        bounds,
        cameraCenterX: (bounds.minX + bounds.maxX) / 2,
        groundVisualY,
        horizontalPadding,
        scale: Math.max(0.01, Math.min(1.25, horizontalScale, verticalScaleAbove, verticalScaleBelow)),
    }
}
