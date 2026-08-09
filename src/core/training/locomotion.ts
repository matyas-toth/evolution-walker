import type {
    Genome,
    LocomotionContactGroup,
    LocomotionCurriculumStage,
    LocomotionMetrics,
    QdArchiveElite,
    QdArchiveExport,
    Topology,
} from "@/core/types"

export const ARCHIVE_DIMENSIONS: [number, number, number] = [12, 10, 8]

export interface CompiledContactGroup {
    id: string
    particleIndices: Uint16Array
    pairedGroup: number
}

/** Integer-indexed functional anatomy shared by every accelerated backend. */
export interface CompiledFunctionalAnatomy {
    coreIndices: Uint16Array
    protectedMask: Uint8Array
    particleGroup: Int16Array
    branchGroup: Int16Array
    contactGroups: CompiledContactGroup[]
    muscleGroup: Int16Array
    muscleNeighbors: Uint16Array[]
    bodyScale: number
    totalMass: number
    baselineCoreHeight: number
    inferred: boolean
}

export interface RawLocomotionSummary {
    progress: number
    sustainedProgress: number
    survivalRatio: number
    stanceSteps: ArrayLike<number>
    strikeCounts: ArrayLike<number>
    intervalMeans: ArrayLike<number>
    intervalM2: ArrayLike<number>
    stanceSlip: number
    protectedClearRatio: number
    coreHeightRatio: number
    landingImpactRms: number
    verticalJerkRms: number
    actuatorWork: number
    airborneRatio: number
    pairedOpposition: number
    pairedBalance: number
    totalMass: number
    bodyScale: number
}

export const EMPTY_LOCOMOTION_METRICS: LocomotionMetrics = {
    progress: 0,
    sustainedProgress: 0,
    locomotionQuality: 0,
    contactUtilization: 0,
    periodicity: 0,
    coordination: -1,
    traction: 0,
    carriage: 0,
    smoothness: 0,
    energyEfficiency: 0,
    transportCost: 0,
    airborneRatio: 0,
    survivalRatio: 0,
    descriptor: [0, 0, 0],
}

export function emptyLocomotionMetrics(): LocomotionMetrics {
    return { ...EMPTY_LOCOMOTION_METRICS, descriptor: [0, 0, 0] }
}

function buildAdjacency(topology: Topology): number[][] {
    const ids = new Map(topology.particles.map((particle, index) => [particle.id, index]))
    const adjacency = Array.from({ length: topology.particles.length }, () => [] as number[])
    const edges = topology.constraints.length ? topology.constraints : topology.muscles
    for (const edge of edges) {
        const left = ids.get(edge.p1Id)
        const right = ids.get(edge.p2Id)
        if (left === undefined || right === undefined || left === right) continue
        adjacency[left].push(right)
        adjacency[right].push(left)
    }
    return adjacency
}

function distancesFrom(start: number, adjacency: number[][]): Int16Array {
    const distances = new Int16Array(adjacency.length)
    distances.fill(-1)
    distances[start] = 0
    const queue = [start]
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const current = queue[cursor]
        for (const neighbor of adjacency[current]) {
            if (distances[neighbor] >= 0) continue
            distances[neighbor] = distances[current] + 1
            queue.push(neighbor)
        }
    }
    return distances
}

function distancesFromMany(starts: readonly number[], adjacency: number[][]): Int16Array {
    const distances = new Int16Array(adjacency.length)
    distances.fill(-1)
    const queue: number[] = []
    for (const start of starts) {
        if (distances[start] >= 0) continue
        distances[start] = 0
        queue.push(start)
    }
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const current = queue[cursor]
        for (const neighbor of adjacency[current]) {
            if (distances[neighbor] >= 0) continue
            distances[neighbor] = distances[current] + 1
            queue.push(neighbor)
        }
    }
    return distances
}

function inferContactGroups(topology: Topology, adjacency: number[][], core: number[]): LocomotionContactGroup[] {
    const coreSet = new Set(core)
    const rootDistances = distancesFrom(core[0], adjacency)
    let maximumDistance = 0
    for (const value of rootDistances) maximumDistance = Math.max(maximumDistance, value)
    const centerX = topology.particles.reduce((sum, particle) => sum + particle.initialPos.x * particle.mass, 0)
        / Math.max(0.0001, topology.particles.reduce((sum, particle) => sum + particle.mass, 0))
    const sortedY = topology.particles.map((particle) => particle.initialPos.y).sort((a, b) => a - b)
    const medianY = sortedY[Math.floor(sortedY.length / 2)] ?? 0
    let candidates = topology.particles
        .map((particle, index) => ({ particle, index }))
        .filter(({ particle, index }) => !coreSet.has(index)
            && particle.initialPos.y >= medianY
            && (adjacency[index].length <= 1 || rootDistances[index] >= maximumDistance * 0.65))
        .sort((left, right) => right.particle.initialPos.y - left.particle.initialPos.y
            || Math.abs(right.particle.initialPos.x - centerX) - Math.abs(left.particle.initialPos.x - centerX))
        .slice(0, 12)
    if (!candidates.length) {
        candidates = topology.particles
            .map((particle, index) => ({ particle, index }))
            .filter(({ index }) => !coreSet.has(index))
            .sort((left, right) => right.particle.initialPos.y - left.particle.initialPos.y)
            .slice(0, Math.min(4, Math.max(1, topology.particles.length - core.length)))
    }

    const groups: LocomotionContactGroup[] = candidates.map(({ particle }, index) => ({
        id: `auto-contact-${index + 1}`,
        particleIds: [particle.id],
    }))
    const paired = new Set<number>()
    for (let left = 0; left < candidates.length; left++) {
        if (paired.has(left)) continue
        let best = -1
        let bestError = Number.POSITIVE_INFINITY
        const leftParticle = candidates[left].particle
        for (let right = left + 1; right < candidates.length; right++) {
            if (paired.has(right)) continue
            const rightParticle = candidates[right].particle
            const mirrorError = Math.abs((leftParticle.initialPos.x - centerX) + (rightParticle.initialPos.x - centerX))
            const heightError = Math.abs(leftParticle.initialPos.y - rightParticle.initialPos.y)
            const depthError = Math.abs(rootDistances[candidates[left].index] - rootDistances[candidates[right].index]) * 5
            const error = mirrorError + heightError + depthError
            if (error < bestError) { best = right; bestError = error }
        }
        if (best >= 0 && bestError <= Math.max(12, topology.particles.length * 2)) {
            groups[left].pairedWith = groups[best].id
            groups[best].pairedWith = groups[left].id
            paired.add(left)
            paired.add(best)
        }
    }
    return groups
}

/** Compiles explicit anatomy or a deterministic graph/geometry inference. */
export function compileFunctionalAnatomy(topology: Topology): CompiledFunctionalAnatomy {
    const count = topology.particles.length
    const ids = new Map(topology.particles.map((particle, index) => [particle.id, index]))
    const adjacency = buildAdjacency(topology)
    const centrality = topology.particles.map((particle, index) => {
        const distances = distancesFrom(index, adjacency)
        let distanceSum = 0
        for (const distance of distances) distanceSum += distance < 0 ? count * 2 : distance
        return { index, score: distanceSum / Math.max(0.1, particle.mass) }
    }).sort((left, right) => left.score - right.score)
    const inferredCore = centrality.slice(0, Math.max(1, Math.ceil(count * 0.25))).map(({ index }) => index)
    const explicitCore = topology.locomotion?.coreParticleIds
        ?.map((id) => ids.get(id)).filter((index): index is number => index !== undefined)
    const core = explicitCore?.length ? explicitCore : inferredCore
    const inferred = !topology.locomotion?.contactGroups?.length
    const groupDefinitions = inferred
        ? inferContactGroups(topology, adjacency, core)
        : topology.locomotion!.contactGroups!
    const groupIndexById = new Map(groupDefinitions.map((group, index) => [group.id, index]))
    const particleGroup = new Int16Array(count)
    particleGroup.fill(-1)
    const contactGroups: CompiledContactGroup[] = groupDefinitions.map((group) => ({
        id: group.id,
        particleIndices: Uint16Array.from(group.particleIds
            .map((id) => ids.get(id)).filter((index): index is number => index !== undefined)),
        pairedGroup: group.pairedWith === undefined ? -1 : (groupIndexById.get(group.pairedWith) ?? -1),
    }))
    contactGroups.forEach((group, groupIndex) => {
        for (const particleIndex of group.particleIndices) particleGroup[particleIndex] = groupIndex
    })
    const branchGroup = new Int16Array(particleGroup)
    const coreDistances = distancesFromMany(core, adjacency)
    const groupDistances = contactGroups.map((group) => distancesFromMany(Array.from(group.particleIndices), adjacency))
    for (let particle = 0; particle < count; particle++) {
        if (branchGroup[particle] >= 0 || core.includes(particle)) continue
        let closestGroup = -1
        let closestDistance = Number.POSITIVE_INFINITY
        groupDistances.forEach((distances, group) => {
            const distance = distances[particle]
            if (distance >= 0 && distance < closestDistance) { closestDistance = distance; closestGroup = group }
        })
        const coreDistance = coreDistances[particle] < 0 ? Number.POSITIVE_INFINITY : coreDistances[particle]
        if (closestGroup >= 0 && closestDistance < coreDistance) branchGroup[particle] = closestGroup
    }

    const protectedMask = new Uint8Array(count)
    const protectedIds = topology.locomotion?.protectedParticleIds
    if (protectedIds?.length) {
        for (const id of protectedIds) {
            const index = ids.get(id)
            if (index !== undefined) protectedMask[index] = 1
        }
    } else {
        for (const index of core) protectedMask[index] = 1
        topology.particles.forEach((particle, index) => {
            if (particle.isHead || particle.id === "head") protectedMask[index] = 1
        })
    }

    const muscleNeighbors = topology.muscles.map((muscle, index) => {
        const neighbors: number[] = []
        for (let candidate = 0; candidate < topology.muscles.length; candidate++) {
            if (candidate === index) continue
            const other = topology.muscles[candidate]
            if (muscle.p1Id === other.p1Id || muscle.p1Id === other.p2Id
                || muscle.p2Id === other.p1Id || muscle.p2Id === other.p2Id) neighbors.push(candidate)
        }
        return Uint16Array.from(neighbors)
    })
    const muscleGroup = new Int16Array(topology.muscles.length)
    muscleGroup.fill(-1)
    topology.muscles.forEach((muscle, muscleIndex) => {
        const first = ids.get(muscle.p1Id)
        const second = ids.get(muscle.p2Id)
        const firstGroup = first === undefined ? -1 : branchGroup[first]
        const secondGroup = second === undefined ? -1 : branchGroup[second]
        muscleGroup[muscleIndex] = firstGroup >= 0 && (secondGroup < 0 || firstGroup === secondGroup)
            ? firstGroup
            : secondGroup
    })

    const minX = Math.min(...topology.particles.map((particle) => particle.initialPos.x))
    const maxX = Math.max(...topology.particles.map((particle) => particle.initialPos.x))
    const minY = Math.min(...topology.particles.map((particle) => particle.initialPos.y))
    const maxY = Math.max(...topology.particles.map((particle) => particle.initialPos.y))
    const bodyScale = Math.max(1, maxX - minX, maxY - minY)
    const totalMass = topology.particles.reduce((sum, particle) => sum + particle.mass, 0)
    const baselineCoreHeight = Math.max(1, 30 - core.reduce((sum, index) => sum + topology.particles[index].initialPos.y, 0)
        / Math.max(1, core.length))

    return {
        coreIndices: Uint16Array.from(core), protectedMask, particleGroup, branchGroup, contactGroups,
        muscleGroup, muscleNeighbors, bodyScale, totalMass, baselineCoreHeight, inferred,
    }
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

/** Converts streaming telemetry into normalized, morphology-independent objectives. */
export function calculateLocomotionMetrics(summary: RawLocomotionSummary): LocomotionMetrics {
    const groupCount = summary.stanceSteps.length
    let totalStance = 0
    for (let group = 0; group < groupCount; group++) totalStance += summary.stanceSteps[group]
    let utilization = groupCount <= 1 ? 1 : 0
    if (groupCount > 1 && totalStance > 0) {
        let entropy = 0
        for (let group = 0; group < groupCount; group++) {
            const share = summary.stanceSteps[group] / totalStance
            if (share > 0) entropy -= share * Math.log(share)
        }
        utilization = clamp01(Math.exp(entropy) / groupCount)
    }

    let periodicitySum = 0
    let periodicGroups = 0
    for (let group = 0; group < groupCount; group++) {
        const intervals = Math.max(0, summary.strikeCounts[group] - 1)
        if (intervals < 2 || summary.intervalMeans[group] <= 0) continue
        const variance = summary.intervalM2[group] / Math.max(1, intervals - 1)
        const coefficient = Math.sqrt(Math.max(0, variance)) / summary.intervalMeans[group]
        periodicitySum += Math.exp(-coefficient * 2)
        periodicGroups++
    }
    const periodicity = periodicGroups ? periodicitySum / periodicGroups : 0
    const traction = Math.exp(-summary.stanceSlip / Math.max(summary.bodyScale, Math.abs(summary.progress) * summary.bodyScale))
    const carriage = clamp01(summary.protectedClearRatio) * clamp01(summary.coreHeightRatio)
    const normalizedImpact = summary.landingImpactRms / Math.sqrt(200 * Math.max(1, summary.bodyScale))
    const normalizedJerk = summary.verticalJerkRms / Math.max(1, summary.bodyScale)
    const smoothness = Math.exp(-normalizedImpact - normalizedJerk)
    const coordination = summary.pairedOpposition < 0
        ? -1
        : Math.sqrt(clamp01(summary.pairedOpposition) * clamp01(summary.pairedBalance))
    const qualityComponents = [utilization, periodicity, traction, carriage, smoothness]
    if (coordination >= 0) qualityComponents.push(coordination)
    const quality = qualityComponents.reduce((product, value) => product * Math.max(0.001, clamp01(value)), 1)
        ** (1 / qualityComponents.length)
    const distance = Math.max(summary.bodyScale * 0.1, Math.max(0, summary.progress) * summary.bodyScale)
    const transportCost = summary.actuatorWork
        / Math.max(0.0001, summary.totalMass * 200 * distance)
    const energyEfficiency = 1 / (1 + Math.max(0, transportCost))

    return {
        progress: summary.progress,
        sustainedProgress: summary.sustainedProgress,
        locomotionQuality: quality * 100,
        contactUtilization: utilization * 100,
        periodicity: periodicity * 100,
        coordination: coordination < 0 ? -1 : coordination * 100,
        traction: traction * 100,
        carriage: carriage * 100,
        smoothness: smoothness * 100,
        energyEfficiency: energyEfficiency * 100,
        transportCost,
        airborneRatio: clamp01(summary.airborneRatio),
        survivalRatio: clamp01(summary.survivalRatio),
        descriptor: [utilization, clamp01(summary.airborneRatio), clamp01(summary.coreHeightRatio)],
    }
}

function dominates(left: LocomotionMetrics, right: LocomotionMetrics): boolean {
    const leftViolation = Math.max(0, 0.25 - left.survivalRatio)
    const rightViolation = Math.max(0, 0.25 - right.survivalRatio)
    if (leftViolation !== rightViolation) return leftViolation < rightViolation
    const objectivesLeft = [left.progress, left.locomotionQuality, left.energyEfficiency, left.survivalRatio]
    const objectivesRight = [right.progress, right.locomotionQuality, right.energyEfficiency, right.survivalRatio]
    let strictlyBetter = false
    for (let index = 0; index < objectivesLeft.length; index++) {
        if (objectivesLeft[index] < objectivesRight[index]) return false
        if (objectivesLeft[index] > objectivesRight[index]) strictlyBetter = true
    }
    return strictlyBetter
}

/** Deterministic constrained NSGA-II ranks and crowding distances. */
export function rankPareto(metrics: readonly LocomotionMetrics[]): { rank: Int32Array; crowding: Float32Array; order: number[] } {
    const dominationCounts = new Int32Array(metrics.length)
    const dominated = Array.from({ length: metrics.length }, () => [] as number[])
    const fronts: number[][] = [[]]
    for (let left = 0; left < metrics.length; left++) {
        for (let right = 0; right < metrics.length; right++) {
            if (left === right) continue
            if (dominates(metrics[left], metrics[right])) dominated[left].push(right)
            else if (dominates(metrics[right], metrics[left])) dominationCounts[left]++
        }
        if (!dominationCounts[left]) fronts[0].push(left)
    }
    const rank = new Int32Array(metrics.length)
    for (let frontIndex = 0; frontIndex < fronts.length && fronts[frontIndex].length; frontIndex++) {
        const next: number[] = []
        for (const member of fronts[frontIndex]) {
            rank[member] = frontIndex
            for (const candidate of dominated[member]) {
                dominationCounts[candidate]--
                if (!dominationCounts[candidate]) next.push(candidate)
            }
        }
        if (next.length) fronts.push(next)
    }

    const crowding = new Float32Array(metrics.length)
    const objectives = [
        (value: LocomotionMetrics) => value.progress,
        (value: LocomotionMetrics) => value.locomotionQuality,
        (value: LocomotionMetrics) => value.energyEfficiency,
        (value: LocomotionMetrics) => value.survivalRatio,
    ]
    for (const front of fronts) {
        if (front.length <= 2) {
            for (const member of front) crowding[member] = Number.POSITIVE_INFINITY
            continue
        }
        for (const objective of objectives) {
            const sorted = [...front].sort((left, right) => objective(metrics[left]) - objective(metrics[right]) || left - right)
            crowding[sorted[0]] = Number.POSITIVE_INFINITY
            crowding[sorted[sorted.length - 1]] = Number.POSITIVE_INFINITY
            const range = objective(metrics[sorted[sorted.length - 1]]) - objective(metrics[sorted[0]]) || 1
            for (let index = 1; index < sorted.length - 1; index++) {
                if (!Number.isFinite(crowding[sorted[index]])) continue
                crowding[sorted[index]] += (objective(metrics[sorted[index + 1]]) - objective(metrics[sorted[index - 1]])) / range
            }
        }
    }
    const order = Array.from({ length: metrics.length }, (_, index) => index)
        .sort((left, right) => rank[left] - rank[right] || crowding[right] - crowding[left] || left - right)
    return { rank, crowding, order }
}

function archiveCell(descriptor: [number, number, number]): number {
    const x = Math.min(ARCHIVE_DIMENSIONS[0] - 1, Math.floor(clamp01(descriptor[0]) * ARCHIVE_DIMENSIONS[0]))
    const y = Math.min(ARCHIVE_DIMENSIONS[1] - 1, Math.floor(clamp01(descriptor[1]) * ARCHIVE_DIMENSIONS[1]))
    const z = Math.min(ARCHIVE_DIMENSIONS[2] - 1, Math.floor(clamp01(descriptor[2]) * ARCHIVE_DIMENSIONS[2]))
    return x + ARCHIVE_DIMENSIONS[0] * (y + ARCHIVE_DIMENSIONS[1] * z)
}

function isBetterElite(candidate: LocomotionMetrics, current: LocomotionMetrics): boolean {
    return candidate.progress > current.progress
        || (candidate.progress === current.progress && candidate.locomotionQuality > current.locomotionQuality)
        || (candidate.progress === current.progress && candidate.locomotionQuality === current.locomotionQuality
            && candidate.transportCost < current.transportCost)
}

/** Bounded MAP-Elites archive with a compact persisted representation. */
export class BehaviorArchive {
    private readonly elites = new Map<number, QdArchiveElite>()

    constructor(initial?: QdArchiveExport) {
        for (const elite of initial?.elites ?? []) this.elites.set(elite.cell, elite)
    }

    consider(metrics: LocomotionMetrics, genome: () => Genome): boolean {
        const cell = archiveCell(metrics.descriptor)
        const current = this.elites.get(cell)
        if (current && !isBetterElite(metrics, current.metrics)) return false
        this.elites.set(cell, { cell, descriptor: [...metrics.descriptor], metrics: { ...metrics, descriptor: [...metrics.descriptor] }, genome: genome() })
        return true
    }

    sample(random: () => number): QdArchiveElite | null {
        if (!this.elites.size) return null
        const target = Math.floor(random() * this.elites.size)
        let cursor = 0
        for (const elite of this.elites.values()) {
            if (cursor++ === target) return elite
        }
        return null
    }

    coverage(): number {
        return this.elites.size / ARCHIVE_DIMENSIONS.reduce((product, value) => product * value, 1)
    }

    export(): QdArchiveExport {
        return { dimensions: ARCHIVE_DIMENSIONS, elites: Array.from(this.elites.values()) }
    }
}

export function resolveCurriculumStage(metrics: readonly LocomotionMetrics[], archiveCoverage: number): LocomotionCurriculumStage {
    if (!metrics.length) return "discovery"
    const bodyLengthMovers = metrics.filter((value) => value.progress >= 1 && value.survivalRatio >= 0.5).length / metrics.length
    if (bodyLengthMovers < 0.2) return "discovery"
    const coordinated = metrics.filter((value) => value.locomotionQuality >= 60).length / metrics.length
    return coordinated >= 0.05 || archiveCoverage >= 0.1 ? "refinement" : "coordination"
}

/** Produces a morphology-neutral gait label from archive descriptors. */
export function describeGait(metrics: LocomotionMetrics): string {
    const support = metrics.airborneRatio > 0.55 ? "aerial" : metrics.airborneRatio < 0.15 ? "grounded" : "stepping"
    const coordination = metrics.coordination < 0 ? "unpaired" : metrics.coordination >= 65 ? "coordinated" : "asymmetric"
    const carriage = metrics.carriage >= 65 ? "high-carriage" : metrics.carriage < 35 ? "low-carriage" : "mid-carriage"
    return `${coordination} ${support}, ${carriage}`
}
