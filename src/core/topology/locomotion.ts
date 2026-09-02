import type { Topology } from '@/core/types'

export const MAX_SUPPORT_GROUPS = 24

export interface LocomotionAnalysis {
  supportGroups: number[][]
  muscleGroups: Int16Array
  initialStandingHeight: number
  source: 'manual' | 'automatic' | 'fallback'
  warnings: string[]
}

function clusterByX(indexes: number[], topology: Topology): number[][] {
  if (indexes.length <= 1) return indexes.map((index) => [index])
  const ordered = [...indexes].sort((left, right) => topology.particles[left].initialPos.x - topology.particles[right].initialPos.x)
  const radii = ordered.map((index) => topology.particles[index].radius).sort((a, b) => a - b)
  const threshold = Math.max(12, (radii[Math.floor(radii.length / 2)] ?? 6) * 4)
  const groups: number[][] = []
  for (const index of ordered) {
    const current = groups.at(-1)
    if (!current) { groups.push([index]); continue }
    const center = current.reduce((sum, candidate) => sum + topology.particles[candidate].initialPos.x, 0) / current.length
    if (Math.abs(topology.particles[index].initialPos.x - center) <= threshold) current.push(index)
    else groups.push([index])
  }
  return groups
}

function buildRigidAdjacency(topology: Topology): number[][] {
  const ids = new Map(topology.particles.map((particle, index) => [particle.id, index]))
  const adjacency = topology.particles.map(() => [] as number[])
  for (const edge of topology.constraints) {
    const left = ids.get(edge.p1Id)
    const right = ids.get(edge.p2Id)
    if (left === undefined || right === undefined) continue
    adjacency[left].push(right)
    adjacency[right].push(left)
  }
  return adjacency
}

function distancesFromGroup(group: number[], adjacency: number[][], blocked: ReadonlySet<number> = new Set()): Int16Array {
  const distances = new Int16Array(adjacency.length)
  distances.fill(0x7fff)
  const queue = [...group]
  group.forEach((index) => { distances[index] = 0 })
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]
    for (const next of adjacency[current]) {
      if (blocked.has(next)) continue
      if (distances[next] <= distances[current] + 1) continue
      distances[next] = distances[current] + 1
      queue.push(next)
    }
  }
  return distances
}

/** Detects arbitrary support counts while respecting explicit editor overrides. */
export function analyzeLocomotion(topology: Topology): LocomotionAnalysis {
  const warnings: string[] = []
  const adjacency = buildRigidAdjacency(topology)
  const manualSupport = topology.particles.map((particle, index) => ({ particle, index }))
    .filter(({ particle }) => particle.locomotionRole === 'support' && !particle.isLocked)
  let supportGroups: number[][]
  let source: LocomotionAnalysis['source']
  if (manualSupport.length) {
    const explicit = new Map<number, number[]>()
    const ungrouped: number[] = []
    for (const { particle, index } of manualSupport) {
      if (Number.isInteger(particle.gaitGroup)) {
        const group = particle.gaitGroup as number
        explicit.set(group, [...(explicit.get(group) ?? []), index])
      } else ungrouped.push(index)
    }
    supportGroups = [...[...explicit.entries()].sort(([a], [b]) => a - b).map(([, indexes]) => indexes), ...clusterByX(ungrouped, topology)]
    source = 'manual'
  } else {
    const unlocked = topology.particles.map((particle, index) => ({ particle, index }))
      .filter(({ particle }) => !particle.isLocked && particle.locomotionRole !== 'body')
    const lowestY = unlocked.reduce((maximum, { particle }) => Math.max(maximum, particle.initialPos.y), Number.NEGATIVE_INFINITY)
    const verticalBand = Math.max(12, ...unlocked.map(({ particle }) => particle.radius * 3))
    const leaves = unlocked.filter(({ particle, index }) => adjacency[index].length <= 1 && particle.initialPos.y >= lowestY - verticalBand).map(({ index }) => index)
    const candidates = leaves.length ? leaves : unlocked.filter(({ particle }) => particle.initialPos.y >= lowestY - verticalBand / 2).map(({ index }) => index)
    supportGroups = clusterByX(candidates, topology)
    source = leaves.length ? 'automatic' : 'fallback'
  }
  if (!supportGroups.length && topology.particles.length) {
    const lowest = topology.particles.reduce((best, particle, index) => particle.initialPos.y > topology.particles[best].initialPos.y ? index : best, 0)
    supportGroups = [[lowest]]
    source = 'fallback'
  }
  const meanX = (group: number[]) => group.reduce((sum, index) => sum + topology.particles[index].initialPos.x, 0) / group.length
  supportGroups.sort((left, right) => meanX(left) - meanX(right))
  supportGroups = supportGroups.slice(0, MAX_SUPPORT_GROUPS)

  const blockedBodyParticles = new Set(topology.particles
    .map((particle, index) => particle.locomotionRole === 'body' ? index : -1)
    .filter((index) => index >= 0))
  const distances = supportGroups.map((group) => distancesFromGroup(group, adjacency, source === 'manual' ? blockedBodyParticles : undefined))
  const ids = new Map(topology.particles.map((particle, index) => [particle.id, index]))
  const head = topology.particles.find((particle) => particle.isHead || particle.id === 'head') ?? topology.particles[0]
  const supportY = supportGroups.flat().reduce((maximum, index) => Math.max(maximum, topology.particles[index].initialPos.y), head?.initialPos.y ?? 0)
  const initialStandingHeight = Math.max(1, supportY - (head?.initialPos.y ?? supportY))
  // Muscles in the lower 35% of the body receive the gait phase. This keeps
  // torso and arm muscles on their small-amplitude stabilising seed profile.
  const lowerBodyThreshold = supportY - initialStandingHeight * 0.35
  const muscleGroups = new Int16Array(topology.muscles.length)
  muscleGroups.fill(-1)
  topology.muscles.forEach((muscle, muscleIndex) => {
    const endpoints = [ids.get(muscle.p1Id), ids.get(muscle.p2Id)].filter((value): value is number => value !== undefined)
    if (!endpoints.length) return
    if (source === 'manual') {
      const directGroups = supportGroups
        .map((group, groupIndex) => endpoints.some((endpoint) => group.includes(endpoint)) ? groupIndex : -1)
        .filter((groupIndex) => groupIndex >= 0)
      if (directGroups.length === 1) {
        muscleGroups[muscleIndex] = directGroups[0]
        return
      }
      if (directGroups.length > 1) {
        warnings.push(`Muscle ${muscle.id} connects competing support groups and was classified as neutral.`)
        return
      }
      if (endpoints.some((endpoint) => blockedBodyParticles.has(endpoint))) return
    }
    const lowestEndpoint = endpoints.reduce((maximum, index) => Math.max(maximum, topology.particles[index].initialPos.y), Number.NEGATIVE_INFINITY)
    let bestGroup = -1
    let bestDistance = 0x7fff
    distances.forEach((groupDistances, groupIndex) => {
      const distance = Math.min(...endpoints.map((index) => groupDistances[index]))
      if (distance < bestDistance) { bestDistance = distance; bestGroup = groupIndex }
    })
    if (source === 'manual' && bestDistance < 0x7fff) {
      const tiedGroups = distances.filter((groupDistances) => Math.min(...endpoints.map((index) => groupDistances[index])) === bestDistance).length
      if (tiedGroups > 1) {
        warnings.push(`Muscle ${muscle.id} is equally connected to multiple support groups and was classified as neutral.`)
        return
      }
    }
    const isEligible = source === 'manual'
      ? bestDistance <= 2
      : bestDistance <= 2 && lowestEndpoint >= lowerBodyThreshold
    if (isEligible || topology.muscles.length === 1) muscleGroups[muscleIndex] = bestGroup
  })

  return { supportGroups, muscleGroups, initialStandingHeight, source, warnings }
}
