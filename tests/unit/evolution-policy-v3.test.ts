import { describe, expect, it } from 'vitest'
import type { Genome } from '@/core/types'
import {
  CandidateMetricOffset,
  CANDIDATE_METRIC_STRIDE,
  EvolutionPolicyV3,
} from '@/core/training/EvolutionPolicyV3'
import { createAsymmetricTwoLegTopology, createTrainingConfig } from '../fixtures/training'

function genomes(count: number): Genome[] {
  const topology = createAsymmetricTwoLegTopology()
  return Array.from({ length: count }, (_, index) => ({
    id: `candidate-${index}`,
    generation: 1,
    createdAt: 0,
    genes: topology.muscles.map((muscle, muscleIndex) => ({
      muscleId: muscle.id,
      amplitude: 0.2 + index * 0.01,
      frequency: 1 + muscleIndex * 0.05,
      phase: muscleIndex % 2 ? Math.PI : 0,
    })),
  }))
}

function metrics(rows: Array<Partial<Record<keyof typeof CandidateMetricOffset, number>>>) {
  const values = new Float32Array(rows.length * CANDIDATE_METRIC_STRIDE)
  rows.forEach((row, index) => {
    const base = index * CANDIDATE_METRIC_STRIDE
    values[base + CandidateMetricOffset.finalCenterX] = row.finalCenterX ?? 100
    values[base + CandidateMetricOffset.maxCenterX] = row.maxCenterX ?? row.finalCenterX ?? 100
    values[base + CandidateMetricOffset.aliveFrames] = row.aliveFrames ?? 600
    values[base + CandidateMetricOffset.totalFrames] = row.totalFrames ?? 600
    values[base + CandidateMetricOffset.headHeightSum] = row.headHeightSum ?? 60_000
    values[base + CandidateMetricOffset.initialStandingHeight] = row.initialStandingHeight ?? 100
    values[base + CandidateMetricOffset.airborneFrames] = row.airborneFrames ?? 0
    values[base + CandidateMetricOffset.alternatingTransitions] = row.alternatingTransitions ?? 10
    values[base + CandidateMetricOffset.reachedTarget] = row.reachedTarget ?? 0
  })
  return { populationSize: rows.length, values }
}

describe('EvolutionPolicyV3', () => {
  it('always ranks a farther distance band above perfect gait in a lower band', () => {
    const policy = new EvolutionPolicyV3(createAsymmetricTwoLegTopology(), createTrainingConfig({ populationSize: 2, targetDistance: 1_100 }))
    const result = policy.evaluateAndEvolve(genomes(2), metrics([
      { finalCenterX: 400, maxCenterX: 400, alternatingTransitions: 20, airborneFrames: 0 },
      { finalCenterX: 420, maxCenterX: 420, alternatingTransitions: 0, airborneFrames: 600, headHeightSum: 0 },
    ]), 1)
    expect(result.bestIndex).toBe(1)
  })

  it('makes target contact outrank every non-winner', () => {
    const policy = new EvolutionPolicyV3(createAsymmetricTwoLegTopology(), createTrainingConfig({ populationSize: 2, targetDistance: 1_100 }))
    const result = policy.evaluateAndEvolve(genomes(2), metrics([
      { finalCenterX: 1_090, maxCenterX: 1_090 },
      { finalCenterX: 250, maxCenterX: 250, reachedTarget: 1 },
    ]), 1)
    expect(result.bestIndex).toBe(1)
    expect(result.targetIndex).toBe(1)
  })

  it('uses gait quality to discriminate candidates inside one distance band', () => {
    const policy = new EvolutionPolicyV3(createAsymmetricTwoLegTopology(), createTrainingConfig({ populationSize: 2, targetDistance: 1_100 }))
    const result = policy.evaluateAndEvolve(genomes(2), metrics([
      { finalCenterX: 400, alternatingTransitions: 0, airborneFrames: 600, headHeightSum: 0 },
      { finalCenterX: 401, alternatingTransitions: 20, airborneFrames: 0, headHeightSum: 60_000 },
    ]), 1)
    expect(result.scores[0].distanceBand).toBe(result.scores[1].distanceBand)
    expect(result.bestIndex).toBe(1)
  })

  it('uses sustained final distance rather than a transient maximum alone', () => {
    const policy = new EvolutionPolicyV3(createAsymmetricTwoLegTopology(), createTrainingConfig({ populationSize: 2, targetDistance: 1_100 }))
    const result = policy.evaluateAndEvolve(genomes(2), metrics([
      { finalCenterX: 200, maxCenterX: 900 },
      { finalCenterX: 500, maxCenterX: 500 },
    ]), 1)
    expect(result.bestIndex).toBe(1)
    expect(result.scores[0].sustainedDistance).toBeCloseTo(275)
    expect(result.scores[1].sustainedDistance).toBeCloseTo(400)
  })

  it('is seeded, bounded, population preserving, and serializes its archive', () => {
    const topology = createAsymmetricTwoLegTopology()
    const config = createTrainingConfig({ populationSize: 8, mutationRate: 1, mutationStrength: 2 })
    const input = genomes(8)
    const inputMetrics = metrics(input.map((_, index) => ({ finalCenterX: 100 + index * 20 })))
    const first = new EvolutionPolicyV3(topology, config)
    const second = new EvolutionPolicyV3(topology, config)
    const firstResult = first.evaluateAndEvolve(input, inputMetrics, 1)
    const secondResult = second.evaluateAndEvolve(input, inputMetrics, 1)
    expect(firstResult.genomes).toEqual(secondResult.genomes)
    expect(firstResult.genomes).toHaveLength(8)
    for (const genome of firstResult.genomes) for (const gene of genome.genes) {
      expect(gene.amplitude).toBeGreaterThanOrEqual(0.05)
      expect(gene.amplitude).toBeLessThanOrEqual(0.8)
      expect(gene.frequency).toBeGreaterThanOrEqual(0.1)
      expect(gene.frequency).toBeLessThanOrEqual(5)
      expect(gene.phase).toBeGreaterThanOrEqual(0)
      expect(gene.phase).toBeLessThan(Math.PI * 2)
    }
    const state = first.exportState()
    expect(state.version).toBe(3)
    expect(state.archive.length).toBeGreaterThan(0)
    expect(new EvolutionPolicyV3(topology, config, state).exportState()).toEqual(state)
  })

  it('sanitizes invalid numeric metrics before ranking', () => {
    const topology = createAsymmetricTwoLegTopology()
    const policy = new EvolutionPolicyV3(topology, createTrainingConfig({ populationSize: 2 }))
    const input = metrics([{ finalCenterX: Number.NaN, maxCenterX: Number.POSITIVE_INFINITY, aliveFrames: Number.NaN }, {}])
    const result = policy.evaluateAndEvolve(genomes(2), input, 1)
    expect(result.scores.flatMap((score) => [score.sustainedDistance, score.gaitQuality, score.fitness, score.alternatingTransitions])
      .every(Number.isFinite)).toBe(true)
  })
})
