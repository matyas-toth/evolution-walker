import type {
  EvolutionArchiveEntry,
  EvolutionPolicyState,
  Genome,
  PackedCandidateMetrics,
  Topology,
  TrainingEngineConfig,
} from '@/core/types'
import { analyzeLocomotion } from '@/core/topology/locomotion'
import { wrapPhase } from './evolutionPolicy'

export const CANDIDATE_METRIC_STRIDE = 10
export const CandidateMetricOffset = {
  finalCenterX: 0,
  maxCenterX: 1,
  aliveFrames: 2,
  totalFrames: 3,
  headHeightSum: 4,
  initialStandingHeight: 5,
  airborneFrames: 6,
  alternatingTransitions: 7,
  reachedTarget: 8,
  firstContactStep: 9,
} as const

const ARCHIVE_PROGRESS_BINS = 20
const ARCHIVE_GAIT_BINS = 10
const TWO_PI = Math.PI * 2

export interface CandidateScore {
  index: number
  sustainedDistance: number
  finalProgress: number
  maxProgress: number
  gaitQuality: number
  survival: number
  alternatingTransitions: number
  reachedTarget: boolean
  distanceBand: number
  novelty: number
  paretoRank: number
  crowdingDistance: number
  fitness: number
}

export interface EvolutionPolicyResult {
  genomes: Genome[]
  scores: CandidateScore[]
  rankedIndexes: number[]
  bestIndex: number
  targetIndex: number
  bestFitness: number
  averageFitness: number
  bestDistance: number
  medianDistance: number
  p90Distance: number
  bestGaitQuality: number
  archiveCoverage: number
  genomeDiversity: number
  stagnationGenerations: number
  championGenome: Genome
}

class StatefulRandom {
  state: number

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5
  }

  next(): number {
    let value = this.state
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.state = value >>> 0
    return this.state / 0x100000000
  }

  gaussian(): number {
    const left = Math.max(Number.EPSILON, this.next())
    return Math.sqrt(-2 * Math.log(left)) * Math.cos(TWO_PI * this.next())
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum))
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0
  const ordered = [...values].sort((left, right) => left - right)
  return ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * fraction))]
}

function archiveCell(progress: number, gaitQuality: number): number {
  const progressBin = Math.min(ARCHIVE_PROGRESS_BINS - 1, Math.floor(clamp(progress, 0, 1) * ARCHIVE_PROGRESS_BINS))
  const gaitBin = Math.min(ARCHIVE_GAIT_BINS - 1, Math.floor(clamp(gaitQuality, 0, 1) * ARCHIVE_GAIT_BINS))
  return progressBin * ARCHIVE_GAIT_BINS + gaitBin
}

function assignCrowding(front: CandidateScore[]): void {
  for (const score of front) score.crowdingDistance = 0
  for (const key of ['gaitQuality', 'novelty'] as const) {
    const ordered = [...front].sort((left, right) => left[key] - right[key])
    if (!ordered.length) continue
    ordered[0].crowdingDistance = Number.POSITIVE_INFINITY
    ordered[ordered.length - 1].crowdingDistance = Number.POSITIVE_INFINITY
    const span = ordered[ordered.length - 1][key] - ordered[0][key]
    if (span <= 0) continue
    for (let index = 1; index < ordered.length - 1; index++) {
      ordered[index].crowdingDistance += (ordered[index + 1][key] - ordered[index - 1][key]) / span
    }
  }
}

/** Assigns exact two-objective Pareto fronts in O(n log n) per distance band. */
export function rankParetoScores(scores: CandidateScore[]): void {
  const bands = new Map<string, CandidateScore[]>()
  for (const score of scores) {
    const key = `${score.reachedTarget ? 1 : 0}:${score.distanceBand}`
    const band = bands.get(key)
    if (band) band.push(score)
    else bands.set(key, [score])
  }
  for (const band of bands.values()) {
    const ordered = [...band].sort((left, right) =>
      right.gaitQuality - left.gaitQuality
      || right.novelty - left.novelty
      || left.index - right.index,
    )
    const noveltyValues = [...new Set(ordered.map((score) => score.novelty))]
      .sort((left, right) => right - left)
    const noveltyIndexes = new Map(noveltyValues.map((value, index) => [value, index + 1]))
    const rankTree = new Uint32Array(noveltyValues.length + 1)
    const fronts: CandidateScore[][] = []
    const queryRank = (index: number) => {
      let rank = 0
      for (let cursor = index; cursor > 0; cursor -= cursor & -cursor) rank = Math.max(rank, rankTree[cursor])
      return rank
    }
    const recordRank = (index: number, value: number) => {
      for (let cursor = index; cursor < rankTree.length; cursor += cursor & -cursor) {
        rankTree[cursor] = Math.max(rankTree[cursor], value)
      }
    }

    for (let start = 0; start < ordered.length;) {
      let end = start + 1
      while (end < ordered.length
        && ordered[end].gaitQuality === ordered[start].gaitQuality
        && ordered[end].novelty === ordered[start].novelty) end++
      const noveltyIndex = noveltyIndexes.get(ordered[start].novelty)!
      const rank = queryRank(noveltyIndex)
      for (let index = start; index < end; index++) {
        const candidate = ordered[index]
        candidate.paretoRank = rank
        const front = fronts[rank] ?? (fronts[rank] = [])
        front.push(candidate)
      }
      recordRank(noveltyIndex, rank + 1)
      start = end
    }
    for (const front of fronts) if (front) assignCrowding(front)
  }
}

/** Coordinator-compatible policy: simulation backends provide metrics; this class alone selects and varies genomes. */
export class EvolutionPolicyV3 {
  private config: TrainingEngineConfig
  private readonly topology: Topology
  private readonly muscleGroups: Int16Array
  private readonly random: StatefulRandom
  private archive = new Map<number, EvolutionArchiveEntry>()
  private stagnationGenerations = 0
  private bestSustainedDistance = 0
  private archiveCursor = 0
  private champion: EvolutionArchiveEntry | undefined
  private nextGenomeId = 1

  constructor(topology: Topology, config: TrainingEngineConfig, state?: EvolutionPolicyState) {
    this.topology = topology
    this.config = config
    this.muscleGroups = analyzeLocomotion(topology).muscleGroups
    this.random = new StatefulRandom(state?.rngState ?? (config.seed ^ 0xa511e9b3))
    if (state?.version === 3) {
      this.stagnationGenerations = state.stagnationGenerations
      this.bestSustainedDistance = state.bestSustainedDistance
      this.archiveCursor = state.archiveCursor
      this.archive = new Map(state.archive.map((entry) => [entry.cell, { ...entry, genome: [...entry.genome] }]))
      this.champion = state.champion ? { ...state.champion, genome: [...state.champion.genome] } : undefined
    }
  }

  updateConfig(config: TrainingEngineConfig): void {
    if (config.targetDistance !== this.config.targetDistance) {
      // Contact with the previous target says nothing about the new target.
      // Keep the genomes and search history, but re-evaluate success on the next run.
      if (this.champion) this.champion.reachedTarget = false
      for (const entry of this.archive.values()) entry.reachedTarget = false
    }
    this.config = config
  }

  dispose(): void {
    this.archive.clear()
    this.champion = undefined
  }

  exportState(): EvolutionPolicyState {
    return {
      version: 3,
      rngState: this.random.state,
      stagnationGenerations: this.stagnationGenerations,
      bestSustainedDistance: this.bestSustainedDistance,
      archiveCursor: this.archiveCursor,
      archive: [...this.archive.values()].map((entry) => ({ ...entry, genome: [...entry.genome] })),
      champion: this.champion ? { ...this.champion, genome: [...this.champion.genome] } : undefined,
    }
  }

  getDiagnostics(): Pick<EvolutionPolicyResult, 'bestDistance' | 'archiveCoverage' | 'stagnationGenerations'> {
    return {
      bestDistance: this.bestSustainedDistance,
      archiveCoverage: this.archive.size / (ARCHIVE_PROGRESS_BINS * ARCHIVE_GAIT_BINS),
      stagnationGenerations: this.stagnationGenerations,
    }
  }

  getChampionGenome(generation: number): Genome | null {
    return this.champion ? this.inflateGenome(this.champion.genome, generation, 'all-time-champion') : null
  }

  getChampionFitness(): number {
    if (!this.champion) return Number.NEGATIVE_INFINITY
    return this.champion.sustainedDistance + this.champion.gaitQuality
      + (this.champion.reachedTarget ? Math.max(1, this.config.targetDistance - 100) : 0)
  }

  evaluateAndEvolve(genomes: Genome[], metrics: PackedCandidateMetrics, generation: number): EvolutionPolicyResult {
    if (metrics.populationSize !== genomes.length || metrics.values.length !== genomes.length * CANDIDATE_METRIC_STRIDE) {
      throw new Error('Evolution policy received mismatched genome and metric slabs')
    }
    const scores = genomes.map((_, index) => this.scoreCandidate(metrics.values, index))
    this.assignNovelty(scores)
    this.assignParetoRanksAndCrowding(scores)
    const rankedIndexes = scores.map((_, index) => index).sort((left, right) => this.compare(scores[left], scores[right]))
    const bestIndex = rankedIndexes[0] ?? 0
    const targetIndex = rankedIndexes.find((index) => scores[index].reachedTarget) ?? -1
    const improvementThreshold = Math.max(1, (this.config.targetDistance - 100) * 0.0025)
    if (scores[bestIndex].sustainedDistance >= this.bestSustainedDistance + improvementThreshold) {
      this.stagnationGenerations = 0
    } else this.stagnationGenerations++
    this.bestSustainedDistance = Math.max(this.bestSustainedDistance, scores[bestIndex].sustainedDistance)
    this.updateArchive(genomes, scores)
    const generationChampion: EvolutionArchiveEntry = {
      cell: archiveCell(scores[bestIndex].finalProgress, scores[bestIndex].gaitQuality),
      genome: this.flattenGenome(genomes[bestIndex]),
      sustainedDistance: scores[bestIndex].sustainedDistance,
      gaitQuality: scores[bestIndex].gaitQuality,
      reachedTarget: scores[bestIndex].reachedTarget,
    }
    if (!this.champion || this.compareArchive(generationChampion, this.champion) < 0) this.champion = generationChampion

    const distances = scores.map((score) => score.sustainedDistance)
    const next = this.createNextPopulation(genomes, scores, rankedIndexes, generation + 1)
    const bestFitness = scores[bestIndex]?.fitness ?? 0
    return {
      genomes: next,
      scores,
      rankedIndexes,
      bestIndex,
      targetIndex,
      bestFitness,
      averageFitness: scores.reduce((sum, score) => sum + score.fitness, 0) / Math.max(1, scores.length),
      bestDistance: Math.max(this.bestSustainedDistance, scores[bestIndex]?.sustainedDistance ?? 0),
      medianDistance: percentile(distances, 0.5),
      p90Distance: percentile(distances, 0.9),
      bestGaitQuality: scores[bestIndex]?.gaitQuality ?? 0,
      archiveCoverage: this.archive.size / (ARCHIVE_PROGRESS_BINS * ARCHIVE_GAIT_BINS),
      genomeDiversity: this.genomeDiversity(genomes),
      stagnationGenerations: this.stagnationGenerations,
      championGenome: this.inflateGenome(this.champion!.genome, generation, 'all-time-champion'),
    }
  }

  private scoreCandidate(values: Float32Array, index: number): CandidateScore {
    const base = index * CANDIDATE_METRIC_STRIDE
    const targetRange = Math.max(1, this.config.targetDistance - 100)
    const finalDistance = clamp(values[base + CandidateMetricOffset.finalCenterX] - 100, 0, targetRange)
    const maximumDistance = clamp(values[base + CandidateMetricOffset.maxCenterX] - 100, 0, targetRange)
    const sustainedDistance = 0.75 * finalDistance + 0.25 * maximumDistance
    const aliveFrames = clamp(values[base + CandidateMetricOffset.aliveFrames], 0, Number.MAX_SAFE_INTEGER)
    const totalFrames = clamp(values[base + CandidateMetricOffset.totalFrames], 1, Number.MAX_SAFE_INTEGER)
    const survival = clamp(aliveFrames / totalFrames, 0, 1)
    const upright = clamp(
      values[base + CandidateMetricOffset.headHeightSum]
      / Math.max(1, aliveFrames)
      / Math.max(1, values[base + CandidateMetricOffset.initialStandingHeight]),
      0,
      1,
    )
    const airborne = clamp(values[base + CandidateMetricOffset.airborneFrames] / Math.max(1, aliveFrames), 0, 1)
    const alternatingTransitions = clamp(values[base + CandidateMetricOffset.alternatingTransitions], 0, Number.MAX_SAFE_INTEGER)
    const seconds = Math.max(1 / 60, totalFrames / 60)
    const alternation = this.muscleGroups.some((group) => group > 0)
      ? clamp(alternatingTransitions / (seconds * 2), 0, 1)
      : 0
    const gaitQuality = clamp(survival * (0.45 * alternation + 0.35 * upright + 0.2 * (1 - airborne)), 0, 1)
    const reachedTarget = values[base + CandidateMetricOffset.reachedTarget] > 0
    // Keep gait as a near-tie preference without hiding incremental forward gains.
    const distanceBand = Math.floor(sustainedDistance / Math.max(0.5, targetRange / 2600))
    return {
      index,
      sustainedDistance,
      finalProgress: finalDistance / targetRange,
      maxProgress: maximumDistance / targetRange,
      gaitQuality,
      survival,
      alternatingTransitions,
      reachedTarget,
      distanceBand,
      novelty: 0,
      paretoRank: 0,
      crowdingDistance: 0,
      fitness: sustainedDistance + gaitQuality + (reachedTarget ? targetRange : 0),
    }
  }

  private assignNovelty(scores: CandidateScore[]): void {
    const descriptors = [...this.archive.values()].map((entry) => ({
      progress: (Math.floor(entry.cell / ARCHIVE_GAIT_BINS) + 0.5) / ARCHIVE_PROGRESS_BINS,
      gait: (entry.cell % ARCHIVE_GAIT_BINS + 0.5) / ARCHIVE_GAIT_BINS,
    }))
    for (const score of scores) {
      if (!descriptors.length) { score.novelty = 1; continue }
      const nearest: number[] = []
      for (const entry of descriptors) {
        const distance = Math.hypot(score.finalProgress - entry.progress, score.gaitQuality - entry.gait)
        let insertion = 0
        while (insertion < nearest.length && nearest[insertion] <= distance) insertion++
        if (insertion < 5) nearest.splice(insertion, 0, distance)
        if (nearest.length > 5) nearest.pop()
      }
      score.novelty = nearest.reduce((sum, value) => sum + value, 0) / nearest.length
    }
  }

  private assignParetoRanksAndCrowding(scores: CandidateScore[]): void {
    rankParetoScores(scores)
  }

  private compare(left: CandidateScore, right: CandidateScore): number {
    if (left.reachedTarget !== right.reachedTarget) return left.reachedTarget ? -1 : 1
    if (left.distanceBand !== right.distanceBand) return right.distanceBand - left.distanceBand
    if (left.paretoRank !== right.paretoRank) return left.paretoRank - right.paretoRank
    if (left.crowdingDistance !== right.crowdingDistance) return right.crowdingDistance - left.crowdingDistance
    return left.index - right.index
  }

  private updateArchive(genomes: Genome[], scores: CandidateScore[]): void {
    for (const score of scores) {
      const cell = archiveCell(score.finalProgress, score.gaitQuality)
      const current = this.archive.get(cell)
      const shouldReplace = !current
        || (score.reachedTarget !== current.reachedTarget ? score.reachedTarget
          : score.sustainedDistance !== current.sustainedDistance
            ? score.sustainedDistance > current.sustainedDistance
            : score.gaitQuality > current.gaitQuality)
      if (!shouldReplace) continue
      this.archive.set(cell, {
        cell,
        genome: this.flattenGenome(genomes[score.index]),
        sustainedDistance: score.sustainedDistance,
        gaitQuality: score.gaitQuality,
        reachedTarget: score.reachedTarget,
      })
    }
  }

  private compareArchive(left: EvolutionArchiveEntry, right: EvolutionArchiveEntry): number {
    if (left.reachedTarget !== right.reachedTarget) return left.reachedTarget ? -1 : 1
    if (left.sustainedDistance !== right.sustainedDistance) return right.sustainedDistance - left.sustainedDistance
    return right.gaitQuality - left.gaitQuality
  }

  private createNextPopulation(genomes: Genome[], scores: CandidateScore[], ranked: number[], generation: number): Genome[] {
    const size = genomes.length
    const next: Genome[] = []
    if (this.champion && size > 0) next.push(this.inflateGenome(this.champion.genome, generation, 'all-time-champion'))
    const eliteCount = Math.min(size, Math.max(0, this.config.elitismCount))
    for (let index = 0; index < eliteCount && next.length < size; index++) next.push(this.cloneGenome(genomes[ranked[index]], generation, true))

    const archiveEntries = [...this.archive.values()].sort((left, right) => this.compareArchive(left, right))
    const archiveEliteCount = Math.min(Math.floor(size * 0.05), archiveEntries.length, size - next.length)
    for (let index = 0; index < archiveEliteCount; index++) {
      const entry = archiveEntries[(this.archiveCursor + index) % archiveEntries.length]
      next.push(this.inflateGenome(entry.genome, generation, `archive-${entry.cell}`))
    }
    if (archiveEntries.length) this.archiveCursor = (this.archiveCursor + archiveEliteCount) % archiveEntries.length

    const stagnant = this.stagnationGenerations >= 50
    const immigrantFraction = stagnant ? 0.10 : 0.05
    const archiveFraction = stagnant ? 0.25 : 0.15
    const immigrantStart = size - Math.round(size * immigrantFraction)
    const archiveStart = Math.max(next.length, immigrantStart - Math.round(size * archiveFraction))
    while (next.length < size) {
      if (next.length >= immigrantStart) {
        next.push(this.createRhythmicImmigrant(generation))
        continue
      }
      const parentAIndex = this.tournament(ranked, scores)
      const parentA = genomes[parentAIndex]
      let parentB: Genome
      if (next.length >= archiveStart && archiveEntries.length) {
        const entry = archiveEntries[Math.floor(this.random.next() * archiveEntries.length)]
        parentB = this.inflateGenome(entry.genome, generation, `archive-${entry.cell}`)
      } else parentB = genomes[this.tournament(ranked, scores)]
      next.push(this.makeChild(parentA, parentB, scores[parentAIndex], generation, next.length >= archiveStart))
    }
    return next
  }

  private tournament(ranked: number[], scores: CandidateScore[]): number {
    const parentCount = Math.max(1, Math.floor(ranked.length * this.config.parentsTopPercent))
    let selected = ranked[Math.floor(this.random.next() * parentCount)]
    for (let index = 1; index < 2; index++) {
      const candidate = ranked[Math.floor(this.random.next() * parentCount)]
      if (this.compare(scores[candidate], scores[selected]) < 0) selected = candidate
    }
    return selected
  }

  private makeChild(parentA: Genome, parentB: Genome, parentAScore: CandidateScore, generation: number, exploration: boolean): Genome {
    const groups = new Map<number, boolean>()
    // Mostly retain a coordinated controller; occasionally exchange a whole limb module.
    for (const group of this.muscleGroups) if (!groups.has(group)) groups.set(group, this.random.next() < 0.9)
    const genes = this.topology.muscles.map((muscle, muscleIndex) => {
      const useA = groups.get(this.muscleGroups[muscleIndex]) ?? (parentAScore.gaitQuality >= 0.5)
      const source = (useA ? parentA : parentB).genes.find((gene) => gene.muscleId === muscle.id)
        ?? parentA.genes[muscleIndex]
      return { ...source, muscleId: muscle.id }
    })
    this.mutate(genes, exploration)
    return {
      id: `genome-v3-${generation}-${this.nextGenomeId++}`,
      genes,
      generation,
      parentIds: [parentA.id, parentB.id],
      createdAt: 0,
    }
  }

  private mutate(genes: Genome['genes'], exploration: boolean): void {
    const strength = this.config.mutationStrength * (exploration ? Math.min(2.5, 1.5 + this.stagnationGenerations / 100) : 1)
    const rate = this.config.mutationRate
    // Explore cadence and phase more than independent frequencies that desynchronize limbs.
    const cadenceShift = this.random.next() < rate * 0.8 ? this.random.gaussian() * 0.7 * strength : 0
    const phaseShifts = new Map<number, number>()
    for (const group of this.muscleGroups) {
      if (group >= 0 && !phaseShifts.has(group) && this.random.next() < rate * 0.7) {
        phaseShifts.set(group, this.random.gaussian() * Math.PI * strength)
      }
    }
    genes.forEach((gene, index) => {
      if (this.random.next() < rate) gene.amplitude = clamp(gene.amplitude + this.random.gaussian() * 0.12 * strength, 0.05, 0.8)
      if (this.random.next() < rate) gene.frequency = clamp(gene.frequency + this.random.gaussian() * 0.2 * strength, 0.1, 5)
      gene.frequency = clamp(gene.frequency + cadenceShift, 0.1, 5)
      const groupShift = phaseShifts.get(this.muscleGroups[index]) ?? 0
      const residual = this.random.next() < rate ? this.random.gaussian() * 1.2 * strength : 0
      gene.phase = wrapPhase(gene.phase + groupShift + residual)
    })
  }

  private createRhythmicImmigrant(generation: number): Genome {
    const tempo = 0.7 + this.random.next() * 0.8
    const groupCount = Math.max(1, Math.max(...this.muscleGroups) + 1)
    return {
      id: `genome-v3-${generation}-${this.nextGenomeId++}`,
      genes: this.topology.muscles.map((muscle, index) => {
        const group = this.muscleGroups[index]
        return {
          muscleId: muscle.id,
          amplitude: group >= 0 ? 0.18 + this.random.next() * 0.34 : 0.05 + this.random.next() * 0.15,
          frequency: clamp(tempo + (this.random.next() - 0.5) * 0.12, 0.1, 5),
          phase: wrapPhase((group >= 0 ? TWO_PI * group / groupCount : 0) + (this.random.next() - 0.5) * 0.24),
        }
      }),
      generation,
      createdAt: 0,
    }
  }

  private flattenGenome(genome: Genome): number[] {
    return this.topology.muscles.flatMap((muscle, index) => {
      const gene = genome.genes.find((candidate) => candidate.muscleId === muscle.id) ?? genome.genes[index]
      return [gene?.amplitude ?? 0.1, gene?.frequency ?? 1, gene?.phase ?? 0]
    })
  }

  private inflateGenome(values: number[], generation: number, parentId: string): Genome {
    return {
      id: `genome-v3-${generation}-${this.nextGenomeId++}`,
      genes: this.topology.muscles.map((muscle, index) => ({
        muscleId: muscle.id,
        amplitude: values[index * 3] ?? 0.1,
        frequency: values[index * 3 + 1] ?? 1,
        phase: values[index * 3 + 2] ?? 0,
      })),
      generation,
      parentIds: [parentId],
      createdAt: 0,
    }
  }

  private cloneGenome(genome: Genome, generation: number, preserveId: boolean): Genome {
    return {
      ...genome,
      id: preserveId ? genome.id : `genome-v3-${generation}-${this.nextGenomeId++}`,
      genes: genome.genes.map((gene) => ({ ...gene })),
      generation,
      createdAt: genome.createdAt ?? 0,
    }
  }

  private genomeDiversity(genomes: Genome[]): number {
    if (genomes.length < 2 || !this.topology.muscles.length) return 0
    let total = 0
    let values = 0
    for (let muscle = 0; muscle < this.topology.muscles.length; muscle++) {
      for (let component = 0; component < 3; component++) {
        let mean = 0
        let squaredDifferenceSum = 0
        let count = 0
        for (const genome of genomes) {
          const gene = genome.genes[muscle]
          const sample = component === 0 ? gene.amplitude : component === 1 ? gene.frequency / 5 : gene.phase / TWO_PI
          count++
          const difference = sample - mean
          mean += difference / count
          squaredDifferenceSum += difference * (sample - mean)
        }
        total += Math.sqrt(squaredDifferenceSum / count)
        values++
      }
    }
    return total / values
  }
}
