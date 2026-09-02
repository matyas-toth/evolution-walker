export interface FitnessMetricsV2 {
  maxCenterX: number
  spawnX: number
  targetX: number
  aliveFrames: number
  totalFrames: number
  headHeightSum: number
  initialStandingHeight: number
  supportAirFrames: number
  supportTransitions: number
  generationDuration: number
  reachedTarget: boolean
}

export interface FitnessResultV2 {
  total: number
  distance: number
  progress: number
  survival: number
  upright: number
  gaitRate: number
  airborne: number
}

export function calculateFitnessV2(metrics: FitnessMetricsV2): FitnessResultV2 {
  const targetDistance = Math.max(1, metrics.targetX - metrics.spawnX)
  const distance = Math.max(0, Math.min(targetDistance, metrics.maxCenterX - metrics.spawnX))
  const progress = distance / targetDistance
  const survival = Math.max(0, Math.min(1, metrics.aliveFrames / Math.max(1, metrics.totalFrames)))
  const upright = Math.max(0, Math.min(1,
    metrics.headHeightSum / Math.max(1, metrics.aliveFrames) / Math.max(1, metrics.initialStandingHeight),
  ))
  const gaitRate = Math.max(0, Math.min(2, metrics.supportTransitions / Math.max(1 / 60, metrics.generationDuration)))
  const airborne = Math.max(0, Math.min(1, metrics.supportAirFrames / Math.max(1, metrics.aliveFrames)))
  const total = distance
    + 250 * Math.sqrt(progress)
    + 120 * survival * (0.25 + 0.75 * upright)
    + 80 * gaitRate * Math.sqrt(progress)
    - 60 * Math.max(0, Math.min(1, (airborne - 0.35) / 0.65))
    - 100 * (1 - survival)
    + (metrics.reachedTarget ? 1000 : 0)
  return { total, distance, progress, survival, upright, gaitRate, airborne }
}

export function adaptiveMutation(baseRate: number, baseStrength: number, stagnationGenerations: number) {
  const boost = Math.max(0, Math.min(1, (stagnationGenerations - 40) / 80))
  return {
    rate: baseRate + (0.25 - baseRate) * boost,
    strength: baseStrength + (0.5 - baseStrength) * boost,
    injectImmigrants: stagnationGenerations >= 80 && stagnationGenerations % 80 === 0,
  }
}

export function wrapPhase(phase: number): number {
  const period = Math.PI * 2
  return ((phase % period) + period) % period
}
