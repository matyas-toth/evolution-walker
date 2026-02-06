'use client';

/**
 * Genetic Algorithm Showcase Page
 * Demonstrates a single random genome controlling creature movement.
 * @module app/showcase/genetic-algorithm/page
 */

import { useEffect, useRef, useState } from 'react';
import { STICKMAN_TOPOLOGY } from '@/core/topology';
import { createCreatureFromTopology, calculateCenterOfMass } from '@/core/simulation/creature';
import { createRandomGenome } from '@/core/genetics';
import { calculateFitness } from '@/core/genetics';
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
import { Creature, Genome } from '@/core/types';

const FIXED_TIMESTEP = 1 / 60; // 60 Hz
const GRAVITY = 200; // 200px/s²
const MUSCLE_STIFFNESS = 0.7; // 70%
const GROUND_FRICTION = 0.7; // 70%

export default function GeneticAlgorithmShowcase() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const timeAccumulatorRef = useRef<number>(0);
  const lastStateUpdateRef = useRef<number>(0);
  
  // Refs to hold latest values (don't trigger re-renders)
  const creatureRef = useRef<Creature | null>(null);
  const genomeRef = useRef<Genome | null>(null);
  const reachedTargetRef = useRef<boolean>(false);
  
  // Creature and genome state (for display only)
  const [creature, setCreature] = useState<Creature | null>(null);
  const [genome, setGenome] = useState<Genome | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [reachedTarget, setReachedTarget] = useState(false);
  const [simulationTime, setSimulationTime] = useState(0);
  // True after first init so physics effect runs when canvas is in DOM
  const [isReady, setIsReady] = useState(false);
  
  // Configuration
  const groundY = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 600;
  const targetZone = {
    x: typeof window !== 'undefined' ? window.innerWidth * 0.7 : 1400,
    y: groundY - 100,
    width: 100,
    height: 80,
  };
  
  // Initialize creature with random genome
  const initializeCreature = () => {
    const randomGenome = createRandomGenome(STICKMAN_TOPOLOGY, 0);
    const spawnPos = { x: 100, y: groundY - 50 };
    const newCreature = createCreatureFromTopology(
      STICKMAN_TOPOLOGY,
      randomGenome,
      spawnPos
    );
    
    genomeRef.current = randomGenome;
    creatureRef.current = newCreature;
    reachedTargetRef.current = false;
    timeAccumulatorRef.current = 0;
    lastStateUpdateRef.current = 0;
    
    setGenome(randomGenome);
    setCreature(newCreature);
    setReachedTarget(false);
    setSimulationTime(0);
    setIsReady(true); // Canvas will be in DOM on next render; physics effect can start
  };
  
  // Initialize on mount
  useEffect(() => {
    initializeCreature();
  }, [groundY]);
  
  // Physics update loop (runs when isReady becomes true, so canvas is in DOM)
  useEffect(() => {
    if (!isReady || !creatureRef.current || !isRunning) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      return;
    }
    
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Set canvas size
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    const update = (currentTime: number) => {
      if (!creatureRef.current) return;
      
      // Calculate delta time
      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;
      
      if (deltaTime > 1000) return; // Skip large jumps
      
      // Fixed timestep physics
      timeAccumulatorRef.current += deltaTime / 1000; // Convert to seconds
      
      // Throttle state updates (every 0.1 seconds) to avoid constant re-renders
      if (timeAccumulatorRef.current - lastStateUpdateRef.current >= 0.1) {
        setSimulationTime(timeAccumulatorRef.current);
        lastStateUpdateRef.current = timeAccumulatorRef.current;
      }
      
      while (timeAccumulatorRef.current >= FIXED_TIMESTEP) {
        const currentCreature = creatureRef.current;
        if (!currentCreature) break;
        
        // Get latest creature from ref
        const workingCreature: Creature = { ...currentCreature };
        
        // Update muscles (genome-driven oscillation)
        updateMuscles(workingCreature.muscles, timeAccumulatorRef.current);
        
        // Update muscle stiffness
        workingCreature.muscles.forEach((muscle) => {
          muscle.stiffness = MUSCLE_STIFFNESS;
        });
        
        // Verlet integration
        workingCreature.particles = integrateVerlet(
          workingCreature.particles,
          { x: 0, y: GRAVITY },
          FIXED_TIMESTEP,
          0.02 // Air resistance
        );
        
        // Satisfy constraints
        const particleMap = createParticleMap(workingCreature.particles);
        const allConstraints = [
          ...workingCreature.constraints,
          ...workingCreature.muscles,
        ];
        satisfyConstraints(allConstraints, particleMap, 3);
        
        // Handle collisions
        workingCreature.particles = handleGroundCollision(
          workingCreature.particles,
          {
            y: groundY,
            friction: GROUND_FRICTION,
            restitution: 0.3,
          }
        );
        
        // Left wall collision
        workingCreature.particles = handleWallCollision(workingCreature.particles, [
          { x: 0, normal: { x: 1, y: 0 } },
        ]);
        
        // Recalculate center of mass
        workingCreature.currentPos = calculateCenterOfMass(workingCreature.particles);
        
        // Update max distance
        workingCreature.maxDistance = Math.max(
          workingCreature.maxDistance,
          workingCreature.currentPos.x
        );
        
        // Check target zone
        if (checkCreatureTargetZone(workingCreature, targetZone)) {
          reachedTargetRef.current = true;
          setReachedTarget(true);
        }
        
        // Update ref with latest creature
        creatureRef.current = workingCreature;
        
        // Throttled state update for display (every 0.1s)
        if (timeAccumulatorRef.current - lastStateUpdateRef.current >= 0.1) {
          setCreature(workingCreature);
        }
        
        timeAccumulatorRef.current -= FIXED_TIMESTEP;
      }
      
      // Render (always use latest from ref)
      const currentCreature = creatureRef.current;
      
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Render ground
      renderGround(ctx, groundY, canvas.width);
      
      // Render target zone
      renderTargetZone(ctx, targetZone);
      
      // Render creature
      if (currentCreature) {
        renderCreature(ctx, currentCreature);
      }
      
      // Render distance indicator
      if (currentCreature) {
        const distance = currentCreature.currentPos.x - currentCreature.startPos.x;
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px sans-serif';
        ctx.fillText(`Distance: ${distance.toFixed(1)}px`, 20, 30);
        ctx.fillText(`Time: ${timeAccumulatorRef.current.toFixed(1)}s`, 20, 50);
      }
      
      // Render success message
      if (reachedTargetRef.current) {
        ctx.fillStyle = '#22c55e';
        ctx.font = 'bold 32px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TARGET REACHED!', canvas.width / 2, canvas.height / 2);
        ctx.textAlign = 'left';
      }
      
      animationFrameRef.current = requestAnimationFrame(update);
    };
    
    lastTimeRef.current = performance.now();
    animationFrameRef.current = requestAnimationFrame(update);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isRunning, isReady, groundY, targetZone.x, targetZone.y, targetZone.width, targetZone.height]);
  
  // Calculate fitness for display
  const fitness = creature
    ? calculateFitness(creature, targetZone, creature.startPos.x)
    : null;
  
  if (!creature || !genome) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }
  
  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ background: '#1a1a1a' }}
      />
      
      {/* Control Panel */}
      <div className="absolute top-4 left-4 z-10 space-y-4">
        <Panel title="Genetic Algorithm Showcase">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Button
                onClick={() => setIsRunning(!isRunning)}
                variant={isRunning ? 'secondary' : 'primary'}
              >
                {isRunning ? 'Pause' : 'Start'}
              </Button>
              <Button onClick={initializeCreature} variant="secondary">
                New Random Genome
              </Button>
            </div>
            
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1 pt-2 border-t">
              <div>
                <span className="font-medium">Status: </span>
                <span className={isRunning ? 'text-green-600' : 'text-gray-600'}>
                  {isRunning ? 'Running' : 'Paused'}
                </span>
              </div>
              {creature && (
                <>
                  <div>
                    <span className="font-medium">Distance: </span>
                    <span>
                      {(creature.currentPos.x - creature.startPos.x).toFixed(1)}px
                    </span>
                  </div>
                  <div>
                    <span className="font-medium">Max Distance: </span>
                    <span>{creature.maxDistance.toFixed(1)}px</span>
                  </div>
                  {fitness && (
                    <div>
                      <span className="font-medium">Fitness: </span>
                      <span>{fitness.total.toFixed(1)}</span>
                    </div>
                  )}
                </>
              )}
              {reachedTarget && (
                <div className="text-green-600 font-bold">✓ Target Reached!</div>
              )}
            </div>
          </div>
        </Panel>
        
        {/* Genome Display */}
        <GenomeDisplay genome={genome} />
      </div>
      
      {/* Info Panel */}
      <div className="absolute top-4 right-4 z-10">
        <Panel>
          <div className="space-y-2 text-sm">
            <div className="font-medium text-gray-900 dark:text-gray-100">
              Configuration
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
              <div>Gravity: {GRAVITY}px/s²</div>
              <div>Muscle Stiffness: {(MUSCLE_STIFFNESS * 100).toFixed(0)}%</div>
              <div>Ground Friction: {(GROUND_FRICTION * 100).toFixed(0)}%</div>
              <div>Time: {simulationTime.toFixed(1)}s</div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
