"use client"

import { useEffect, useState } from "react"
import type { PackedTrainingReplay } from "@/core/types"

const CONTACT_HOLD_MS = 750

/** Plays immutable worker-generated trajectory frames without running browser physics. */
export function useReplay(replay: PackedTrainingReplay | null) {
    const [frameIndex, setFrameIndex] = useState(0)
    const [replayProgress, setReplayProgress] = useState(0)

    useEffect(() => {
        setFrameIndex(0)
        setReplayProgress(0)
        if (!replay || replay.reachedFrame < 0) return

        let animationFrame = 0
        const startedAt = performance.now()
        const motionDurationMs = replay.reachedFrame / replay.frameRate * 1000
        const loopDurationMs = Math.max(1, motionDurationMs + CONTACT_HOLD_MS)

        const animate = (now: number) => {
            const elapsed = (now - startedAt) % loopDurationMs
            const holding = elapsed >= motionDurationMs
            const nextFrame = holding
                ? replay.reachedFrame
                : Math.min(replay.reachedFrame, Math.floor(elapsed / 1000 * replay.frameRate))
            setFrameIndex((current) => current === nextFrame ? current : nextFrame)
            const nextProgress = holding || replay.reachedFrame === 0 ? 1 : nextFrame / replay.reachedFrame
            setReplayProgress((current) => current === nextProgress ? current : nextProgress)
            animationFrame = requestAnimationFrame(animate)
        }

        animationFrame = requestAnimationFrame(animate)
        return () => cancelAnimationFrame(animationFrame)
    }, [replay])

    return {
        frameIndex,
        replayProgress,
        isReplaying: Boolean(replay),
    }
}
