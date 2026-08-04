import type {
    Genome,
    MuscleGene,
    Topology,
    TrainingEngineConfig,
    TrainingEngineState,
    TrainingSnapshot,
    TrainingStageTimings,
} from "@/core/types"
import type { EvaluatedGeneration, TrainingBackendEngine } from "./engineBackend"

const FIXED_TIMESTEP = 1 / 60
const GRAVITY = 200
const AIR_RESISTANCE = 0.02
const GROUND_FRICTION = 0.7
const GROUND_RESTITUTION = 0.3
const MUSCLE_STIFFNESS = 0.9
const TWO_PI = Math.PI * 2
const UPRIGHT_WEIGHT = 50
const TARGET_BONUS = 1000
const DEATH_PENALTY = -500

interface CompiledTopology {
    particleCount: number
    constraintCount: number
    muscleCount: number
    initialX: Float32Array
    initialY: Float32Array
    mass: Float32Array
    radius: Float32Array
    locked: Uint8Array
    headIndex: number
    constraintP1: Uint16Array
    constraintP2: Uint16Array
    constraintLength: Float32Array
    constraintStiffness: Float32Array
    constraintMuscle: Int16Array
    muscleIds: string[]
}

/** Small deterministic generator used for reproducible population creation and evolution. */
class XorShift32 {
    private state: number

    constructor(seed: number) {
        this.state = seed >>> 0 || 0x6d2b79f5
    }

    nextU32(): number {
        let value = this.state
        value ^= value << 13
        value ^= value >>> 17
        value ^= value << 5
        this.state = value >>> 0
        return this.state
    }

    next(): number {
        return this.nextU32() / 0x100000000
    }
}

/** Compiles string-based topology references once into compact integer-indexed arrays. */
function compileTopology(topology: Topology): CompiledTopology {
    const particleCount = topology.particles.length
    const muscleCount = topology.muscles.length
    const constraintCount = topology.constraints.length + muscleCount
    const idToIndex = new Map(topology.particles.map((particle, index) => [particle.id, index]))
    const initialX = new Float32Array(particleCount)
    const initialY = new Float32Array(particleCount)
    const mass = new Float32Array(particleCount)
    const radius = new Float32Array(particleCount)
    const locked = new Uint8Array(particleCount)
    let headIndex = topology.particles.findIndex((particle) => particle.isHead)
    if (headIndex < 0) headIndex = Math.max(0, topology.particles.findIndex((particle) => particle.id === "head"))

    for (let index = 0; index < particleCount; index++) {
        const particle = topology.particles[index]
        initialX[index] = particle.initialPos.x
        initialY[index] = particle.initialPos.y
        mass[index] = particle.mass
        radius[index] = particle.radius
        locked[index] = particle.isLocked ? 1 : 0
    }

    const constraintP1 = new Uint16Array(constraintCount)
    const constraintP2 = new Uint16Array(constraintCount)
    const constraintLength = new Float32Array(constraintCount)
    const constraintStiffness = new Float32Array(constraintCount)
    const constraintMuscle = new Int16Array(constraintCount)
    constraintMuscle.fill(-1)

    topology.constraints.forEach((constraint, index) => {
        constraintP1[index] = idToIndex.get(constraint.p1Id) ?? 0
        constraintP2[index] = idToIndex.get(constraint.p2Id) ?? 0
        constraintLength[index] = constraint.restLength
        constraintStiffness[index] = constraint.stiffness
    })

    topology.muscles.forEach((muscle, muscleIndex) => {
        const index = topology.constraints.length + muscleIndex
        constraintP1[index] = idToIndex.get(muscle.p1Id) ?? 0
        constraintP2[index] = idToIndex.get(muscle.p2Id) ?? 0
        constraintLength[index] = muscle.baseLength
        constraintStiffness[index] = MUSCLE_STIFFNESS
        constraintMuscle[index] = muscleIndex
    })

    return {
        particleCount,
        constraintCount,
        muscleCount,
        initialX,
        initialY,
        mass,
        radius,
        locked,
        headIndex,
        constraintP1,
        constraintP2,
        constraintLength,
        constraintStiffness,
        constraintMuscle,
        muscleIds: topology.muscles.map((muscle) => muscle.id),
    }
}

/** Packed worker-owned CPU engine with persistent arrays and bounded simulation chunks. */
export class PackedCpuTrainingEngine implements TrainingBackendEngine {
    private readonly topology: CompiledTopology
    private config: TrainingEngineConfig
    private readonly rng: XorShift32
    private populationSize: number
    private generation: number
    private totalSteps: number
    private readonly totalGenerationSteps: number
    private readonly spawnX = 100
    private readonly spawnY: number
    private genomes: Float32Array
    private genomeIds: Uint32Array
    private parentA: Uint32Array
    private parentB: Uint32Array
    private x: Float32Array
    private y: Float32Array
    private oldX: Float32Array
    private oldY: Float32Array
    private alive: Uint8Array
    private reachedTarget: Uint8Array
    private currentX: Float32Array
    private currentY: Float32Array
    private maxDistance: Float32Array
    private minHeadY: Float32Array
    private fitness: Float32Array
    private oscillatorSin: Float32Array
    private oscillatorCos: Float32Array
    private oscillatorStepSin: Float32Array
    private oscillatorStepCos: Float32Array
    private bestGenome: Float32Array | null = null
    private bestFitness = Number.NEGATIVE_INFINITY
    private nextGenomeId = 1
    private lastEvaluated: EvaluatedGeneration | null = null
    private timings: TrainingStageTimings = {
        initializeMs: 0,
        simulationMs: 0,
        fitnessMs: 0,
        evolutionMs: 0,
        resetMs: 0,
        transferMs: 0,
        totalGenerationMs: 0,
    }
    private generationStartedAt = 0
    private completedGenerationTimes: number[] = []

    constructor(
        topology: Topology,
        config: TrainingEngineConfig,
        initialPopulation?: Genome[],
        initialGeneration = 1,
    ) {
        const startedAt = performance.now()
        this.topology = compileTopology(topology)
        this.config = config
        this.populationSize = config.populationSize
        this.generation = initialGeneration
        this.totalSteps = 0
        this.totalGenerationSteps = Math.max(1, Math.round(config.generationDuration / FIXED_TIMESTEP))
        this.spawnY = 600 - 30
        this.rng = new XorShift32(config.seed)

        const genomeValueCount = this.populationSize * this.topology.muscleCount * 3
        const particleValueCount = this.populationSize * this.topology.particleCount
        this.genomes = new Float32Array(genomeValueCount)
        this.genomeIds = new Uint32Array(this.populationSize)
        this.parentA = new Uint32Array(this.populationSize)
        this.parentB = new Uint32Array(this.populationSize)
        this.x = new Float32Array(particleValueCount)
        this.y = new Float32Array(particleValueCount)
        this.oldX = new Float32Array(particleValueCount)
        this.oldY = new Float32Array(particleValueCount)
        this.alive = new Uint8Array(this.populationSize)
        this.reachedTarget = new Uint8Array(this.populationSize)
        this.currentX = new Float32Array(this.populationSize)
        this.currentY = new Float32Array(this.populationSize)
        this.maxDistance = new Float32Array(this.populationSize)
        this.minHeadY = new Float32Array(this.populationSize)
        this.fitness = new Float32Array(this.populationSize)
        this.oscillatorSin = new Float32Array(this.populationSize * this.topology.muscleCount)
        this.oscillatorCos = new Float32Array(this.populationSize * this.topology.muscleCount)
        this.oscillatorStepSin = new Float32Array(this.populationSize * this.topology.muscleCount)
        this.oscillatorStepCos = new Float32Array(this.populationSize * this.topology.muscleCount)

        this.initializeGenomes(initialPopulation)
        this.resetPopulation()
        this.timings.initializeMs = performance.now() - startedAt
        this.generationStartedAt = performance.now()
    }

    updateConfig(config: TrainingEngineConfig): void {
        this.config = config
    }

    getGeneration(): number {
        return this.generation
    }

    getProgress(): number {
        return Math.round((this.totalSteps / this.totalGenerationSteps) * 100)
    }

    /** Advances a bounded number of physics steps and yields to the worker event loop. */
    runChunk(maxSteps: number, budgetMs: number): boolean {
        if (this.totalSteps === 0) this.timings.simulationMs = 0
        const startedAt = performance.now()
        const endStep = Math.min(this.totalGenerationSteps, this.totalSteps + Math.max(1, maxSteps))
        while (this.totalSteps < endStep) {
            this.step(this.totalSteps)
            this.totalSteps++
            if (performance.now() - startedAt >= budgetMs) break
        }
        this.timings.simulationMs += performance.now() - startedAt
        return this.totalSteps >= this.totalGenerationSteps
    }

    /** Scores and evolves a completed population without materializing creature objects. */
    finishGeneration(): EvaluatedGeneration {
        const fitnessStartedAt = performance.now()
        let bestFitness = Number.NEGATIVE_INFINITY
        let averageFitness = 0
        let bestIndex = 0
        let targetIndex = -1

        for (let creature = 0; creature < this.populationSize; creature++) {
            const distance = this.maxDistance[creature] - this.spawnX
            const targetCenterX = this.config.targetDistance + 50
            const distanceToTarget = Math.abs(this.currentX[creature] - targetCenterX)
            const maxTargetDistance = Math.abs(this.config.targetDistance - this.spawnX)
            const targetBonus = this.reachedTarget[creature]
                ? TARGET_BONUS
                : Math.max(0, 1 - distanceToTarget / Math.max(1, maxTargetDistance)) * 500
            const uprightBonus = UPRIGHT_WEIGHT * Math.max(0, (600 - this.minHeadY[creature]) / 600)
            const deathPenalty = this.alive[creature] ? 0 : DEATH_PENALTY
            const total = distance + targetBonus + uprightBonus + deathPenalty
            this.fitness[creature] = total
            averageFitness += total
            if (total > bestFitness) {
                bestFitness = total
                bestIndex = creature
            }
            if (targetIndex < 0 && this.reachedTarget[creature]) targetIndex = creature
        }
        averageFitness /= this.populationSize
        this.timings.fitnessMs = performance.now() - fitnessStartedAt

        if (bestFitness > this.bestFitness) {
            this.bestFitness = bestFitness
            this.bestGenome = this.copyGenome(bestIndex)
        }

        const evaluated: EvaluatedGeneration = {
            generation: this.generation,
            bestFitness,
            averageFitness,
            bestIndex,
            targetIndex,
            bestGenome: this.materializeGenome(
                this.copyGenome(bestIndex),
                this.genomeIds[bestIndex],
                this.generation,
                this.parentA[bestIndex],
                this.parentB[bestIndex],
            ),
            targetGenome: targetIndex >= 0
                ? this.materializeGenome(
                    this.copyGenome(targetIndex),
                    this.genomeIds[targetIndex],
                    this.generation,
                    this.parentA[targetIndex],
                    this.parentB[targetIndex],
                )
                : null,
        }
        this.lastEvaluated = evaluated

        const evolutionStartedAt = performance.now()
        this.evolve()
        this.timings.evolutionMs = performance.now() - evolutionStartedAt
        const resetStartedAt = performance.now()
        this.generation++
        this.totalSteps = 0
        this.resetPopulation()
        this.timings.resetMs = performance.now() - resetStartedAt
        this.timings.totalGenerationMs = performance.now() - this.generationStartedAt
        this.completedGenerationTimes.push(this.timings.totalGenerationMs)
        if (this.completedGenerationTimes.length > 30) this.completedGenerationTimes.shift()
        this.generationStartedAt = performance.now()
        return evaluated
    }

    getSnapshot(phase: TrainingSnapshot["phase"], includeRender: boolean): TrainingSnapshot {
        const averageDuration = this.completedGenerationTimes.length
            ? this.completedGenerationTimes.reduce((sum, value) => sum + value, 0) / this.completedGenerationTimes.length
            : 0
        return {
            phase,
            generation: this.generation,
            progress: this.getProgress(),
            bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : 0,
            averageFitness: this.lastEvaluated?.averageFitness ?? 0,
            diagnostics: {
                backend: "wasm-scalar",
                workerCount: 1,
                generationsPerSecond: averageDuration > 0 ? 1000 / averageDuration : 0,
                stageTimings: { ...this.timings },
                droppedSnapshots: 0,
                memoryBytes: this.memoryBytes(),
            },
            render: includeRender ? this.createRenderSnapshot(5) : undefined,
        }
    }

    getEvaluatedGenome(index: number, generation: number): Genome {
        return this.materializeGenome(this.copyGenome(index), this.genomeIds[index], generation, this.parentA[index], this.parentB[index])
    }

    getBestGenome(): Genome | null {
        if (!this.bestGenome) return null
        return this.materializeGenome(this.bestGenome, 0, this.generation)
    }

    exportState(): TrainingEngineState {
        const population = Array.from({ length: this.populationSize }, (_, index) =>
            this.materializeGenome(
                this.copyGenome(index),
                this.genomeIds[index],
                this.generation,
                this.parentA[index],
                this.parentB[index],
            ),
        )
        return {
            population,
            bestGenome: this.getBestGenome(),
            bestFitness: Number.isFinite(this.bestFitness) ? this.bestFitness : 0,
            generation: this.generation,
        }
    }

    private initializeGenomes(initialPopulation?: Genome[]): void {
        for (let creature = 0; creature < this.populationSize; creature++) {
            const source = initialPopulation?.[creature]
            this.genomeIds[creature] = this.nextGenomeId++
            for (let muscle = 0; muscle < this.topology.muscleCount; muscle++) {
                const base = (creature * this.topology.muscleCount + muscle) * 3
                const gene = source?.genes.find((candidate) => candidate.muscleId === this.topology.muscleIds[muscle])
                this.genomes[base] = gene?.amplitude ?? this.rng.next() * 0.5 + 0.1
                this.genomes[base + 1] = gene?.frequency ?? this.rng.next() * 2 + 0.1
                this.genomes[base + 2] = gene?.phase ?? this.rng.next() * TWO_PI
            }
        }
    }

    private resetPopulation(): void {
        const { particleCount, muscleCount } = this.topology
        for (let creature = 0; creature < this.populationSize; creature++) {
            this.alive[creature] = 1
            this.reachedTarget[creature] = 0
            let totalMass = 0
            let weightedX = 0
            let weightedY = 0
            const particleBase = creature * particleCount
            for (let particle = 0; particle < particleCount; particle++) {
                const index = particleBase + particle
                const x = this.spawnX + this.topology.initialX[particle]
                const y = this.spawnY + this.topology.initialY[particle]
                this.x[index] = x
                this.y[index] = y
                this.oldX[index] = x
                this.oldY[index] = y
                totalMass += this.topology.mass[particle]
                weightedX += x * this.topology.mass[particle]
                weightedY += y * this.topology.mass[particle]
            }
            this.currentX[creature] = weightedX / totalMass
            this.currentY[creature] = weightedY / totalMass
            this.maxDistance[creature] = this.currentX[creature]
            const headY = this.y[particleBase + this.topology.headIndex]
            this.minHeadY[creature] = headY
            for (let muscle = 0; muscle < muscleCount; muscle++) {
                const oscillatorIndex = creature * muscleCount + muscle
                const genomeIndex = oscillatorIndex * 3
                const phase = this.genomes[genomeIndex + 2]
                const step = TWO_PI * this.genomes[genomeIndex + 1] * FIXED_TIMESTEP
                this.oscillatorSin[oscillatorIndex] = Math.sin(phase)
                this.oscillatorCos[oscillatorIndex] = Math.cos(phase)
                this.oscillatorStepSin[oscillatorIndex] = Math.sin(step)
                this.oscillatorStepCos[oscillatorIndex] = Math.cos(step)
            }
        }
    }

    private step(stepNumber: number): void {
        const { particleCount, constraintCount, muscleCount } = this.topology
        const damping = 1 - AIR_RESISTANCE
        const dtSquared = FIXED_TIMESTEP * FIXED_TIMESTEP
        const targetX = this.config.targetDistance
        const targetY = 500

        for (let creature = 0; creature < this.populationSize; creature++) {
            if (!this.alive[creature]) continue
            const particleBase = creature * particleCount
            const muscleBase = creature * muscleCount

            for (let particle = 0; particle < particleCount; particle++) {
                if (this.topology.locked[particle]) continue
                const index = particleBase + particle
                const posX = this.x[index]
                const posY = this.y[index]
                const velocityX = (posX - this.oldX[index]) * damping
                const velocityY = (posY - this.oldY[index]) * damping
                this.oldX[index] = posX
                this.oldY[index] = posY
                this.x[index] = posX + velocityX
                this.y[index] = posY + velocityY + (GRAVITY / this.topology.mass[particle]) * dtSquared
            }

            for (let iteration = 0; iteration < 3; iteration++) {
                for (let constraint = 0; constraint < constraintCount; constraint++) {
                    const p1 = this.topology.constraintP1[constraint]
                    const p2 = this.topology.constraintP2[constraint]
                    const p1Index = particleBase + p1
                    const p2Index = particleBase + p2
                    const dx = this.x[p2Index] - this.x[p1Index]
                    const dy = this.y[p2Index] - this.y[p1Index]
                    const distance = Math.sqrt(dx * dx + dy * dy)
                    if (distance === 0) continue
                    const muscle = this.topology.constraintMuscle[constraint]
                    const targetLength = muscle >= 0
                        ? this.topology.constraintLength[constraint]
                            * (1 + this.genomes[(muscleBase + muscle) * 3] * this.oscillatorSin[muscleBase + muscle])
                        : this.topology.constraintLength[constraint]
                    const difference = distance - targetLength
                    if (Math.abs(difference) < 0.01) continue
                    const scale = (difference * this.topology.constraintStiffness[constraint]) / distance
                    const correctionX = dx * scale
                    const correctionY = dy * scale
                    const totalMass = this.topology.mass[p1] + this.topology.mass[p2]
                    const p1Ratio = this.topology.mass[p2] / totalMass
                    const p2Ratio = this.topology.mass[p1] / totalMass
                    if (!this.topology.locked[p1]) {
                        this.x[p1Index] += correctionX * p1Ratio
                        this.y[p1Index] += correctionY * p1Ratio
                    }
                    if (!this.topology.locked[p2]) {
                        this.x[p2Index] -= correctionX * p2Ratio
                        this.y[p2Index] -= correctionY * p2Ratio
                    }
                }
            }

            let totalMass = 0
            let weightedX = 0
            let weightedY = 0
            for (let particle = 0; particle < particleCount; particle++) {
                const index = particleBase + particle
                const radius = this.topology.radius[particle]
                const maxY = 600 - radius
                if (this.y[index] > maxY) {
                    const velocityX = this.x[index] - this.oldX[index]
                    const velocityY = this.y[index] - this.oldY[index]
                    this.y[index] = maxY
                    this.oldY[index] = maxY + velocityY * GROUND_RESTITUTION
                    this.oldX[index] = this.x[index] - velocityX * GROUND_FRICTION
                }
                if (this.x[index] < radius) {
                    this.x[index] = radius
                    this.oldX[index] = radius
                }
                totalMass += this.topology.mass[particle]
                weightedX += this.x[index] * this.topology.mass[particle]
                weightedY += this.y[index] * this.topology.mass[particle]
                if (!this.reachedTarget[creature]
                    && this.x[index] >= targetX && this.x[index] <= targetX + 100
                    && this.y[index] >= targetY && this.y[index] <= targetY + 80) {
                    this.reachedTarget[creature] = 1
                }
            }

            const headIndex = particleBase + this.topology.headIndex
            const headY = this.y[headIndex]
            if (headY >= 600 - this.topology.radius[this.topology.headIndex]) {
                this.alive[creature] = 0
            } else {
                this.minHeadY[creature] = Math.min(this.minHeadY[creature], headY)
                this.currentX[creature] = weightedX / totalMass
                this.currentY[creature] = weightedY / totalMass
                this.maxDistance[creature] = Math.max(this.maxDistance[creature], this.currentX[creature])
            }

            for (let muscle = 0; muscle < muscleCount; muscle++) {
                const index = muscleBase + muscle
                const sin = this.oscillatorSin[index]
                const cos = this.oscillatorCos[index]
                this.oscillatorSin[index] = sin * this.oscillatorStepCos[index] + cos * this.oscillatorStepSin[index]
                this.oscillatorCos[index] = cos * this.oscillatorStepCos[index] - sin * this.oscillatorStepSin[index]
                if ((stepNumber & 255) === 255) {
                    const magnitude = Math.hypot(this.oscillatorSin[index], this.oscillatorCos[index]) || 1
                    this.oscillatorSin[index] /= magnitude
                    this.oscillatorCos[index] /= magnitude
                }
            }
        }
    }

    private evolve(): void {
        const ranked = Array.from({ length: this.populationSize }, (_, index) => index)
        ranked.sort((left, right) => this.fitness[right] - this.fitness[left])
        const parentCount = Math.max(1, Math.floor(this.populationSize * this.config.parentsTopPercent))
        const next = new Float32Array(this.genomes.length)
        const nextIds = new Uint32Array(this.populationSize)
        const nextParentA = new Uint32Array(this.populationSize)
        const nextParentB = new Uint32Array(this.populationSize)
        const genomeStride = this.topology.muscleCount * 3
        const eliteCount = Math.min(this.config.elitismCount, this.populationSize)

        for (let child = 0; child < this.populationSize; child++) {
            if (child < eliteCount) {
                const source = ranked[child]
                next.set(this.genomes.subarray(source * genomeStride, (source + 1) * genomeStride), child * genomeStride)
                nextIds[child] = this.genomeIds[source]
                nextParentA[child] = this.parentA[source]
                nextParentB[child] = this.parentB[source]
                continue
            }

            const parent1 = this.tournament(ranked, parentCount)
            const parent2 = this.tournament(ranked, parentCount)
            const bias = this.fitness[parent1] >= this.fitness[parent2] ? 0.6 : 0.4
            for (let value = 0; value < genomeStride; value++) {
                const source = this.rng.next() < bias ? parent1 : parent2
                let result = this.genomes[source * genomeStride + value]
                if (this.rng.next() <= this.config.mutationRate) {
                    const change = (this.rng.next() - 0.5) * 2 * this.config.mutationStrength
                    result *= 1 + change
                    const component = value % 3
                    result = component === 0
                        ? Math.max(0.05, Math.min(0.8, result))
                        : component === 1
                            ? Math.max(0.1, Math.min(5, result))
                            : Math.max(0, Math.min(TWO_PI, result))
                }
                next[child * genomeStride + value] = result
            }
            nextIds[child] = this.nextGenomeId++
            nextParentA[child] = this.genomeIds[parent1]
            nextParentB[child] = this.genomeIds[parent2]
        }

        this.genomes = next
        this.genomeIds = nextIds
        this.parentA = nextParentA
        this.parentB = nextParentB
    }

    private tournament(ranked: number[], parentCount: number): number {
        let best = ranked[Math.floor(this.rng.next() * parentCount)]
        for (let index = 1; index < 3; index++) {
            const candidate = ranked[Math.floor(this.rng.next() * parentCount)]
            if (this.fitness[candidate] > this.fitness[best]) best = candidate
        }
        return best
    }

    private copyGenome(creature: number): Float32Array {
        const stride = this.topology.muscleCount * 3
        return this.genomes.slice(creature * stride, (creature + 1) * stride)
    }

    private materializeGenome(values: Float32Array, id: number, generation: number, parentA = 0, parentB = 0): Genome {
        const genes: MuscleGene[] = this.topology.muscleIds.map((muscleId, muscle) => ({
            muscleId,
            amplitude: values[muscle * 3],
            frequency: values[muscle * 3 + 1],
            phase: values[muscle * 3 + 2],
        }))
        return {
            id: id ? `genome-${id}` : `genome-best-${generation}`,
            genes,
            generation,
            parentIds: parentA || parentB
                ? [parentA ? `genome-${parentA}` : "", parentB ? `genome-${parentB}` : ""].filter(Boolean)
                : undefined,
            createdAt: Date.now(),
        }
    }

    private createRenderSnapshot(count: number): TrainingSnapshot["render"] {
        const ranked = Array.from({ length: this.populationSize }, (_, index) => index)
        ranked.sort((left, right) => this.currentX[right] - this.currentX[left])
        const creatureCount = Math.min(count, this.populationSize)
        const positions = new Float32Array(creatureCount * this.topology.particleCount * 2)
        const centers = new Float32Array(creatureCount * 2)
        for (let output = 0; output < creatureCount; output++) {
            const creature = ranked[output]
            centers[output * 2] = this.currentX[creature]
            centers[output * 2 + 1] = this.currentY[creature]
            for (let particle = 0; particle < this.topology.particleCount; particle++) {
                const source = creature * this.topology.particleCount + particle
                const target = (output * this.topology.particleCount + particle) * 2
                positions[target] = this.x[source]
                positions[target + 1] = this.y[source]
            }
        }
        return { creatureCount, particleCount: this.topology.particleCount, positions, centers }
    }

    private memoryBytes(): number {
        return this.genomes.byteLength + this.genomeIds.byteLength + this.parentA.byteLength + this.parentB.byteLength
            + this.x.byteLength + this.y.byteLength + this.oldX.byteLength + this.oldY.byteLength
            + this.alive.byteLength + this.reachedTarget.byteLength + this.currentX.byteLength
            + this.currentY.byteLength + this.maxDistance.byteLength + this.minHeadY.byteLength
            + this.fitness.byteLength + this.oscillatorSin.byteLength + this.oscillatorCos.byteLength
            + this.oscillatorStepSin.byteLength + this.oscillatorStepCos.byteLength
    }
}
