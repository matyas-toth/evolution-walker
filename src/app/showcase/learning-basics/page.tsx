'use client';

/**
 * Learning Basics Showcase
 * Evolution loop: 50 creatures, 15s per generation, GA until one reaches target.
 * @module app/showcase/learning-basics/page
 */

import { useEffect, useRef, useState } from 'react';
import { STICKMAN_TOPOLOGY } from '@/core/topology';
import { createCreatureFromTopology, calculateCenterOfMass } from '@/core/simulation/creature';
import {
  createInitialPopulation,
  calculateFitness,
  selectElites,
  selectParents,
  tournamentSelection,
  arithmeticCrossover,
  mutateGenome,
} from '@/core/genetics';
import {
  integrateVerlet,
  updateMuscles,
  satisfyConstraints,
  createParticleMap,
  handleGroundCollision,
  handleWallCollision,
  checkCreatureTargetZone,
} from '@/core/physics';
import { renderCreature, renderGround, renderTargetZone } from '@/components/creatures/CreatureRenderer';
import { GenomeDisplay } from '@/components/genetics/GenomeDisplay';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Creature } from '@/core/types';

const FIXED_TIMESTEP = 1 / 60;
const GRAVITY = 200;
const MUSCLE_STIFFNESS = 0.8;
const GROUND_FRICTION = 0.7;
const POPULATION_SIZE = 1000;
const GENERATION_DURATION = 15;
const ELITISM_COUNT = 2;
const PARENTS_TOP_PERCENT = 0.2;
const MUTATION_RATE = 0.05;
const MUTATION_STRENGTH = 0.25;
const TOP_DISPLAY_COUNT = 5;

type Phase = 'running' | 'evaluating' | 'evolving' | 'replay' | 'winner';

function getCreatureColor(index: number): string {
  return `hsl(${(index * 360) / POPULATION_SIZE}, 78%, 58%)`;
}

export default function LearningBasicsShowcase() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const timeAccumulatorRef = useRef<number>(0);
  const totalSimTimeRef = useRef<number>(0);
  const generationTimeRef = useRef<number>(0);
  const lastStateUpdateRef = useRef<number>(0);

  const creaturesRef = useRef<Creature[]>([]);
  const creatureColorsRef = useRef<string[]>([]);
  const phaseRef = useRef<Phase>('running');
  const winnerCreatureRef = useRef<Creature | null>(null);
  const generationRef = useRef<number>(0);
  const speedMultiplierRef = useRef<number>(1);
  const replayCreatureRef = useRef<Creature | null>(null);

  const [creatures, setCreatures] = useState<Creature[]>([]);
  const [phase, setPhase] = useState<Phase>('running');
  const [generation, setGeneration] = useState(0);
  const [generationTime, setGenerationTime] = useState(0);
  const [simulationTime, setSimulationTime] = useState(0);
  const [winnerCreature, setWinnerCreature] = useState<Creature | null>(null);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    speedMultiplierRef.current = Math.max(0.1, Math.min(100, speedMultiplier));
  }, [speedMultiplier]);

  const groundY = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 600;
  const targetZone = {
    x: typeof window !== 'undefined' ? window.innerWidth * 0.7 : 1400,
    y: groundY - 100,
    width: 100,
    height: 80,
  };

  function initializePopulation() {
    const genomes = createInitialPopulation(STICKMAN_TOPOLOGY, POPULATION_SIZE);
    const colors = Array.from({ length: POPULATION_SIZE }, (_, i) => getCreatureColor(i));
    const spawnPos = { x: 100, y: groundY - 30 };
    const newCreatures: Creature[] = genomes.map((genome) =>
      createCreatureFromTopology(STICKMAN_TOPOLOGY, genome, spawnPos)
    );
    creaturesRef.current = newCreatures;
    creatureColorsRef.current = colors;
    phaseRef.current = 'running';
    setPhase('running');
    winnerCreatureRef.current = null;
    setWinnerCreature(null);
    replayCreatureRef.current = null;
    generationRef.current = 0;
    setGeneration(0);
    timeAccumulatorRef.current = 0;
    totalSimTimeRef.current = 0;
    generationTimeRef.current = 0;
    lastStateUpdateRef.current = 0;
    setCreatures([...newCreatures]);
    setGenerationTime(0);
    setSimulationTime(0);
    setIsReady(true);
  }

  useEffect(() => {
    initializePopulation();
  }, [groundY]);

  useEffect(() => {
    if (!isReady || creaturesRef.current.length === 0) {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const update = (currentTime: number) => {
      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;
      if (deltaTime > 1000) return;

      const currentPhase = phaseRef.current;

      if (currentPhase === 'evaluating') {
        const creatures = creaturesRef.current;
        for (let i = 0; i < creatures.length; i++) {
          const c = creatures[i];
          c.fitness = calculateFitness(c, targetZone, c.startPos.x);
        }
        setCreatures([...creaturesRef.current]);
        const winner = creatures.find((c) => c.reachedTarget) ?? null;
        if (winner) {
          setSpeedMultiplier(1);
          speedMultiplierRef.current = 1;
          const spawnPos = { x: 100, y: groundY - 30 };
          replayCreatureRef.current = createCreatureFromTopology(
            STICKMAN_TOPOLOGY,
            winner.genome,
            spawnPos
          );
          totalSimTimeRef.current = 0;
          timeAccumulatorRef.current = 0;
          phaseRef.current = 'replay';
          setPhase('replay');
        } else {
          phaseRef.current = 'evolving';
          setPhase('evolving');
        }
        animationFrameRef.current = requestAnimationFrame(update);
        return;
      }

      if (currentPhase === 'evolving') {
        const creatures = creaturesRef.current;
        const elites = selectElites(creatures, ELITISM_COUNT);
        const parents = selectParents(creatures, PARENTS_TOP_PERCENT);
        const nextGenomes = elites.map((c) => c.genome);
        const currentGen = generationRef.current;
        while (nextGenomes.length < POPULATION_SIZE) {
          const p1 = tournamentSelection(parents, 3);
          const p2 = tournamentSelection(parents, 3);
          let offspring = arithmeticCrossover(p1.genome, p2.genome);
          offspring = mutateGenome(offspring, MUTATION_RATE, MUTATION_STRENGTH);
          offspring = { ...offspring, generation: currentGen + 1 };
          nextGenomes.push(offspring);
        }
        const colors = creatureColorsRef.current;
        const spawnPos = { x: 100, y: groundY - 30 };
        const newCreatures: Creature[] = nextGenomes.map((genome) =>
          createCreatureFromTopology(STICKMAN_TOPOLOGY, genome, spawnPos)
        );
        creaturesRef.current = newCreatures;
        generationRef.current = currentGen + 1;
        setGeneration(currentGen + 1);
        generationTimeRef.current = 0;
        totalSimTimeRef.current = 0;
        timeAccumulatorRef.current = 0;
        lastStateUpdateRef.current = 0;
        phaseRef.current = 'running';
        setPhase('running');
        setCreatures([...newCreatures]);
        animationFrameRef.current = requestAnimationFrame(update);
        return;
      }

      if (currentPhase === 'replay') {
        const replayCreature = replayCreatureRef.current;
        if (!replayCreature) {
          animationFrameRef.current = requestAnimationFrame(update);
          return;
        }
        const replayDelta = deltaTime / 1000;
        timeAccumulatorRef.current += replayDelta;
        while (timeAccumulatorRef.current >= FIXED_TIMESTEP) {
          const workingCreature: Creature = { ...replayCreatureRef.current! };
          updateMuscles(workingCreature.muscles, totalSimTimeRef.current);
          workingCreature.muscles.forEach((m) => {
            m.stiffness = MUSCLE_STIFFNESS;
          });
          workingCreature.particles = integrateVerlet(
            workingCreature.particles,
            { x: 0, y: GRAVITY },
            FIXED_TIMESTEP,
            0.02
          );
          const particleMap = createParticleMap(workingCreature.particles);
          satisfyConstraints(
            [...workingCreature.constraints, ...workingCreature.muscles],
            particleMap,
            3
          );
          workingCreature.particles = handleGroundCollision(workingCreature.particles, {
            y: groundY,
            friction: GROUND_FRICTION,
            restitution: 0.3,
          });
          workingCreature.particles = handleWallCollision(workingCreature.particles, [
            { x: 0, normal: { x: 1, y: 0 } },
          ]);
          workingCreature.currentPos = calculateCenterOfMass(workingCreature.particles);
          workingCreature.maxDistance = Math.max(
            workingCreature.maxDistance,
            workingCreature.currentPos.x
          );
          if (checkCreatureTargetZone(workingCreature, targetZone)) {
            workingCreature.reachedTarget = true;
          }
          replayCreatureRef.current = workingCreature;
          totalSimTimeRef.current += FIXED_TIMESTEP;
          timeAccumulatorRef.current -= FIXED_TIMESTEP;
          if (workingCreature.reachedTarget) {
            winnerCreatureRef.current = workingCreature;
            setWinnerCreature(workingCreature);
            phaseRef.current = 'winner';
            setPhase('winner');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            renderGround(ctx, groundY, canvas.width);
            renderTargetZone(ctx, targetZone);
            renderCreature(ctx, workingCreature, 1, '#22c55e');
            ctx.fillStyle = '#22c55e';
            ctx.font = 'bold 24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(
              `Target Reached! Winner: Gen ${generationRef.current}`,
              canvas.width / 2,
              canvas.height / 2 - 20
            );
            ctx.textAlign = 'left';
            animationFrameRef.current = requestAnimationFrame(update);
            return;
          }
        }
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        renderGround(ctx, groundY, canvas.width);
        renderTargetZone(ctx, targetZone);
        const rc = replayCreatureRef.current;
        if (rc) renderCreature(ctx, rc, 1, '#22c55e');
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px sans-serif';
        ctx.fillText('Replay (1x)', 20, 30);
        ctx.fillText(`Phase: replay`, 20, 50);
        animationFrameRef.current = requestAnimationFrame(update);
        return;
      }

      if (currentPhase === 'winner') {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        renderGround(ctx, groundY, canvas.width);
        renderTargetZone(ctx, targetZone);
        const winner = winnerCreatureRef.current;
        if (winner) {
          renderCreature(ctx, winner, 1, '#22c55e');
        }
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 24px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(
          `Target Reached! Winner: Gen ${generationRef.current}`,
          canvas.width / 2,
          canvas.height / 2 - 20
        );
        ctx.textAlign = 'left';
        animationFrameRef.current = requestAnimationFrame(update);
        return;
      }

      if (currentPhase === 'running') {
        const simDelta = (deltaTime / 1000) * speedMultiplierRef.current;
        timeAccumulatorRef.current += simDelta;
        generationTimeRef.current = Math.min(
          generationTimeRef.current + simDelta,
          GENERATION_DURATION
        );

        if (totalSimTimeRef.current - lastStateUpdateRef.current >= 0.1) {
          const list = creaturesRef.current;
          for (let i = 0; i < list.length; i++) {
            list[i].fitness = calculateFitness(list[i], targetZone, list[i].startPos.x);
          }
          setSimulationTime(totalSimTimeRef.current);
          setGenerationTime(generationTimeRef.current);
          setCreatures([...list]);
          setPhase(phaseRef.current);
          lastStateUpdateRef.current = totalSimTimeRef.current;
        }

        const maxStepsPerFrame = 120;
        let stepsThisFrame = 0;
        while (timeAccumulatorRef.current >= FIXED_TIMESTEP && stepsThisFrame < maxStepsPerFrame) {
          stepsThisFrame += 1;
          const list = creaturesRef.current;
          for (let i = 0; i < list.length; i++) {
            const workingCreature: Creature = { ...list[i] };
            updateMuscles(workingCreature.muscles, totalSimTimeRef.current);
            workingCreature.muscles.forEach((m) => {
              m.stiffness = MUSCLE_STIFFNESS;
            });
            workingCreature.particles = integrateVerlet(
              workingCreature.particles,
              { x: 0, y: GRAVITY },
              FIXED_TIMESTEP,
              0.02
            );
            const particleMap = createParticleMap(workingCreature.particles);
            satisfyConstraints(
              [...workingCreature.constraints, ...workingCreature.muscles],
              particleMap,
              3
            );
            workingCreature.particles = handleGroundCollision(workingCreature.particles, {
              y: groundY,
              friction: GROUND_FRICTION,
              restitution: 0.3,
            });
            workingCreature.particles = handleWallCollision(workingCreature.particles, [
              { x: 0, normal: { x: 1, y: 0 } },
            ]);
            workingCreature.currentPos = calculateCenterOfMass(workingCreature.particles);
            workingCreature.maxDistance = Math.max(
              workingCreature.maxDistance,
              workingCreature.currentPos.x
            );
            if (checkCreatureTargetZone(workingCreature, targetZone)) {
              workingCreature.reachedTarget = true;
            }
            list[i] = workingCreature;
          }
          totalSimTimeRef.current += FIXED_TIMESTEP;
          timeAccumulatorRef.current -= FIXED_TIMESTEP;

          if (generationTimeRef.current >= GENERATION_DURATION) {
            phaseRef.current = 'evaluating';
            setPhase('evaluating');
            break;
          }
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      renderGround(ctx, groundY, canvas.width);
      renderTargetZone(ctx, targetZone);

      if (currentPhase === 'running' || phaseRef.current === 'running') {
        const list = creaturesRef.current;
        const colors = creatureColorsRef.current;
        const withIndex = list.map((creature, index) => ({ creature, index }));
        const top = withIndex
          .sort(
            (a, b) =>
              (b.creature.fitness?.total ?? -Infinity) -
              (a.creature.fitness?.total ?? -Infinity)
          )
          .slice(0, Math.min(TOP_DISPLAY_COUNT, list.length));
        for (const { creature, index } of top) {
          renderCreature(ctx, creature, 1, colors[index]);
        }
      }

      ctx.fillStyle = '#ffffff';
      ctx.font = '16px sans-serif';
      ctx.fillText(`Gen ${generationRef.current} | ${generationTimeRef.current.toFixed(1)}s`, 20, 30);
      ctx.fillText(`Phase: ${phaseRef.current}`, 20, 50);

      animationFrameRef.current = requestAnimationFrame(update);
    };

    lastTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(update);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [isReady, groundY, targetZone.x, targetZone.y, targetZone.width, targetZone.height]);

  const bestFitness =
    creatures.length > 0
      ? Math.max(...creatures.map((c) => c.fitness?.total ?? -Infinity))
      : 0;
  const avgFitness =
    creatures.length > 0
      ? creatures.reduce((s, c) => s + (c.fitness?.total ?? 0), 0) / creatures.length
      : 0;

  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ background: '#1a1a1a' }}
      />
      <div className="absolute top-4 left-4 z-10 space-y-4">
        <Panel title="Learning Basics">
          <div className="space-y-3">
            <Button onClick={initializePopulation} variant="primary">
              Run again
            </Button>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap">
                  Speed: {phase === 'replay' ? '1x (Replay)' : `${Number(speedMultiplier).toFixed(1)}x`}
                </label>
                <input
                  type="range"
                  min={0.1}
                  max={100}
                  step={0.1}
                  value={phase === 'replay' ? 1 : speedMultiplier}
                  disabled={phase === 'replay'}
                  onChange={(e) => setSpeedMultiplier(Number(e.target.value))}
                  className="flex-1 h-2 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1 pt-2 border-t">
              <div>
                <span className="font-medium">Phase: </span>
                <span>{phase}</span>
              </div>
              <div>
                <span className="font-medium">Generation: </span>
                <span>{generation}</span>
              </div>
              <div>
                <span className="font-medium">Time: </span>
                <span>{generationTime.toFixed(1)}s / {GENERATION_DURATION}s</span>
              </div>
              {creatures.length > 0 && (
                <>
                  <div>
                    <span className="font-medium">Best fitness: </span>
                    <span>{bestFitness.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="font-medium">Avg fitness: </span>
                    <span>{avgFitness.toFixed(1)}</span>
                  </div>
                </>
              )}
              {phase === 'winner' && winnerCreature && (
                <div className="text-green-600 font-bold">Target reached!</div>
              )}
            </div>
          </div>
        </Panel>
        {phase === 'winner' && winnerCreature && (
          <GenomeDisplay genome={winnerCreature.genome} />
        )}
      </div>
      <div className="absolute top-4 right-4 z-10">
        <Panel>
          <div className="space-y-2 text-sm">
            <div className="font-medium text-gray-900 dark:text-gray-100">Config</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <div>Population: {POPULATION_SIZE}</div>
              <div>Generation duration: {GENERATION_DURATION}s</div>
              <div>Elitism: {ELITISM_COUNT}</div>
              <div>Mutation: {(MUTATION_RATE * 100).toFixed(0)}%</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
