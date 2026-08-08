/// <reference lib="webworker" />

import { RustWasmTrainingEngine } from "./RustWasmTrainingEngine"
import type { ActiveTrainingBackend, Genome, Topology, TrainingEngineConfig } from "@/core/types"

type ShardCommand =
    | { id: number; type: "init"; topology: Topology; config: TrainingEngineConfig; population?: Genome[]; generation: number; backend: ActiveTrainingBackend }
    | { id: number; type: "run"; maxSteps: number; budgetMs: number; includeRender: boolean }
    | { id: number; type: "finish" }
    | { id: number; type: "update"; config: TrainingEngineConfig }
    | { id: number; type: "export" }
    | { id: number; type: "dispose" }

const scope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope
let engine: RustWasmTrainingEngine | null = null

scope.onmessage = async (message: MessageEvent<ShardCommand>) => {
    const command = message.data
    try {
        switch (command.type) {
            case "init":
                engine = await RustWasmTrainingEngine.create(command.topology, command.config, command.population, command.generation, command.backend)
                scope.postMessage({ id: command.id, ok: true })
                break
            case "run": {
                if (!engine) throw new Error("Shard is not initialized")
                const completed = engine.runChunk(command.maxSteps, command.budgetMs)
                const snapshot = command.includeRender ? engine.getSnapshot("running", true) : undefined
                const transfer: Transferable[] = snapshot?.render
                    ? [snapshot.render.positions.buffer, snapshot.render.centers.buffer]
                    : []
                scope.postMessage({ id: command.id, completed, progress: engine.getProgress(), snapshot }, transfer)
                break
            }
            case "finish": {
                if (!engine) throw new Error("Shard is not initialized")
                const evaluated = engine.finishGeneration()
                const snapshot = engine.getSnapshot("running", true)
                const transfer: Transferable[] = snapshot.render
                    ? [snapshot.render.positions.buffer, snapshot.render.centers.buffer]
                    : []
                scope.postMessage({ id: command.id, evaluated, snapshot }, transfer)
                break
            }
            case "update":
                engine?.updateConfig(command.config)
                scope.postMessage({ id: command.id, ok: true })
                break
            case "export":
                if (!engine) throw new Error("Shard is not initialized")
                scope.postMessage({ id: command.id, state: engine.exportState() })
                break
            case "dispose":
                scope.postMessage({ id: command.id, ok: true })
                scope.close()
                break
        }
    } catch (error) {
        scope.postMessage({ id: command.id, error: error instanceof Error ? error.message : "Unknown shard failure" })
    }
}

export {}
