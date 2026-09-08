import type { TrainingEvent } from "@/core/types"

export interface PreparedTrainingEvent {
    event: TrainingEvent
    transfer: Transferable[]
}

/**
 * Creates an outbound event whose transferable buffers are owned exclusively
 * by the receiver. Engine snapshots may cache their render arrays, so sending
 * those arrays directly would detach state that later snapshots still need.
 */
export function prepareTrainingEvent(event: TrainingEvent): PreparedTrainingEvent {
    if ((event.type === "snapshot" || event.type === "ready" || event.type === "paused") && event.snapshot.render) {
        const render = event.snapshot.render
        const positions = render.positions.slice()
        const centers = render.centers.slice()
        return {
            event: {
                ...event,
                snapshot: {
                    ...event.snapshot,
                    render: { ...render, positions, centers },
                },
            },
            transfer: [positions.buffer, centers.buffer],
        }
    }

    if (event.type === "replayReady") {
        return {
            event,
            transfer: [event.replay.positions.buffer, event.replay.centers.buffer],
        }
    }

    return { event, transfer: [] }
}
