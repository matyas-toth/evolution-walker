/** Deterministic random and gait-aware population creation. */
import type { Genome, MuscleGene, Topology } from '@/core/types'
import { analyzeLocomotion } from '@/core/topology/locomotion'

export class SeededRandom {
  private state: number
  constructor(seed: number) { this.state = seed >>> 0 || 0x6d2b79f5 }
  next(): number {
    let value = this.state
    value ^= value << 13
    value ^= value >>> 17
    value ^= value << 5
    this.state = value >>> 0
    return this.state / 0x100000000
  }
}

function buildGenome(topology: Topology, generation: number, index: number, random: () => number, rhythmic: boolean): Genome {
  const locomotion = analyzeLocomotion(topology)
  const tempo = 0.7 + random() * 0.8
  const groupCount = Math.max(1, locomotion.supportGroups.length)
  const genes: MuscleGene[] = topology.muscles.map((muscle, muscleIndex) => {
    const group = locomotion.muscleGroups[muscleIndex]
    if (!rhythmic) return {
      muscleId: muscle.id,
      amplitude: 0.1 + random() * 0.5,
      frequency: 0.1 + random() * 2,
      phase: random() * Math.PI * 2,
    }
    const groupPhase = group >= 0 ? Math.PI * 2 * group / groupCount : 0
    return {
      muscleId: muscle.id,
      amplitude: group >= 0 ? 0.18 + random() * 0.34 : 0.05 + random() * 0.15,
      frequency: Math.max(0.1, Math.min(5, tempo + (random() - 0.5) * 0.12)),
      phase: (groupPhase + (random() - 0.5) * 0.24 + Math.PI * 2) % (Math.PI * 2),
    }
  })
  return { id: `genome-${generation}-${index}`, genes, generation, createdAt: 0 }
}

/**
 * Creates a random genome for a given topology
 * Generates random gene values for each muscle in the topology
 * 
 * @param topology Topology definition containing muscles
 * @param generation Generation number (default: 0)
 * @returns Random genome with unique ID
 */
export function createRandomGenome(
  topology: Topology,
  generation: number = 0 
): Genome {
  return { ...buildGenome(topology, generation, Math.floor(Math.random() * 1e9), Math.random, false), createdAt: Date.now() }
}

/** Creates the exact same 60/40 rhythmic/random mix for every training backend. */
export function createSeededInitialPopulation(topology: Topology, size: number, seed: number, generation = 1): Genome[] {
  const rng = new SeededRandom(seed)
  const rhythmicCount = Math.round(size * 0.6)
  return Array.from({ length: size }, (_, index) =>
    buildGenome(topology, generation, index, () => rng.next(), index < rhythmicCount),
  )
}

/**
 * Creates an initial population of random genomes
 * All genomes start at generation 0
 * 
 * @param topology Topology definition
 * @param size Number of genomes to create
 * @returns Array of random genomes
 */
export function createInitialPopulation(
  topology: Topology,
  size: number
): Genome[] {
  return Array.from({ length: size }, () => createRandomGenome(topology, 0));
}
