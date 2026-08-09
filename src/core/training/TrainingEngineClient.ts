import type {
    Genome,
    PackedTrainingReplay,
    Topology,
    TrainingCommand,
    TrainingEngineConfig,
    TrainingEngineState,
    TrainingEvent,
} from "@/core/types"

type EventListener = (event: TrainingEvent) => void

/** Browser-side owner of the persistent training coordinator worker. */
export class TrainingEngineClient {
    private readonly worker: Worker
    private readonly listeners = new Set<EventListener>()
    private readonly pendingExports = new Map<number, {
        resolve: (state: TrainingEngineState) => void
        reject: (error: Error) => void
    }>()
    private readonly pendingReplays = new Map<number, {
        resolve: (replay: PackedTrainingReplay) => void
        reject: (error: Error) => void
    }>()
    private requestId = 0
    private disposed = false

    constructor() {
        this.worker = new Worker(new URL("./training.worker.ts", import.meta.url), {
            type: "module",
            name: "evolution-training-coordinator",
        })
        this.worker.onmessage = (message: MessageEvent<TrainingEvent>) => {
            const event = message.data
            if (event.type === "sessionExported") {
                const pending = this.pendingExports.get(event.requestId)
                if (pending) {
                    this.pendingExports.delete(event.requestId)
                    pending.resolve(event.state)
                }
            }
            if (event.type === "replayReady" || event.type === "replayFailed") {
                const pending = this.pendingReplays.get(event.requestId)
                if (pending) {
                    this.pendingReplays.delete(event.requestId)
                    if (event.type === "replayReady") pending.resolve(event.replay)
                    else pending.reject(new Error(event.message))
                }
            }
            for (const listener of this.listeners) listener(event)
        }
        this.worker.onerror = (event) => {
            const error = new Error(event.message || "Training worker failed")
            for (const pending of this.pendingExports.values()) pending.reject(error)
            this.pendingExports.clear()
            for (const pending of this.pendingReplays.values()) pending.reject(error)
            this.pendingReplays.clear()
            const workerEvent: TrainingEvent = { type: "error", message: error.message, recoverable: false }
            for (const listener of this.listeners) listener(workerEvent)
        }
    }

    subscribe(listener: EventListener): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    initialize(
        topology: Topology,
        config: TrainingEngineConfig,
        initialPopulation?: Genome[],
        initialGeneration?: number,
    ): void {
        this.post({ type: "init", topology, config, initialPopulation, initialGeneration })
    }

    start(): void {
        this.post({ type: "start" })
    }

    pause(): void {
        this.post({ type: "pause" })
    }

    reset(): void {
        this.post({ type: "reset" })
    }

    updateConfig(config: TrainingEngineConfig): void {
        this.post({ type: "updateConfig", config })
    }

    exportSession(): Promise<TrainingEngineState> {
        const requestId = ++this.requestId
        return new Promise((resolve, reject) => {
            this.pendingExports.set(requestId, { resolve, reject })
            this.post({ type: "exportSession", requestId })
        })
    }

    requestReplay(genome: Genome): Promise<PackedTrainingReplay> {
        const requestId = ++this.requestId
        return new Promise((resolve, reject) => {
            this.pendingReplays.set(requestId, { resolve, reject })
            this.post({ type: "requestReplay", requestId, genome })
        })
    }

    dispose(): void {
        if (this.disposed) return
        this.post({ type: "dispose" })
        this.disposed = true
        this.worker.terminate()
        const error = new Error("Training engine disposed")
        for (const pending of this.pendingExports.values()) pending.reject(error)
        this.pendingExports.clear()
        for (const pending of this.pendingReplays.values()) pending.reject(error)
        this.pendingReplays.clear()
        this.listeners.clear()
    }

    private post(command: TrainingCommand): void {
        if (this.disposed) return
        this.worker.postMessage(command)
    }
}
