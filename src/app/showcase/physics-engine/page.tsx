'use client';

/**
 * Physics Engine Showcase Page
 * Demonstrates the physics engine with manual control of a stickman creature.
 * @module app/showcase/physics-engine/page
 */

import { useEffect, useRef, useState } from 'react';
import { STICKMAN_TOPOLOGY } from '@/core/topology';
import { createCreatureFromTopology, calculateCenterOfMass } from '@/core/simulation/creature';
import { createDefaultConfig } from '@/core/simulation/utils';
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
import { Button } from '@/components/ui/Button';
import { Slider } from '@/components/ui/Slider';
import { Panel } from '@/components/ui/Panel';
import { Creature, Muscle } from '@/core/types';

const FIXED_TIMESTEP = 1 / 60; // 60 Hz

export default function PhysicsEngineShowcase() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | undefined>(undefined);
  const lastTimeRef = useRef<number>(0);
  const timeAccumulatorRef = useRef<number>(0);
  
  // Creature state
  const [creature, setCreature] = useState<Creature | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [reachedTarget, setReachedTarget] = useState(false);
  
  // Configuration
  const [gravity, setGravity] = useState(100);
  const [muscleStiffness, setMuscleStiffness] = useState(0.7);
  const [groundFriction, setGroundFriction] = useState(0.2);
  
  // Manual muscle control state
  const [manualMuscleState, setManualMuscleState] = useState<Record<string, number>>({});
  
  // Get config
  const config = createDefaultConfig();
  const groundY = config.groundY;
  const targetZone = config.targetZone;
  
  // Initialize creature
  useEffect(() => {
    const spawnPos = { x: 100, y: groundY - 50 };
    const newCreature = createCreatureFromTopology(STICKMAN_TOPOLOGY, undefined, spawnPos);
    setCreature(newCreature);
    setReachedTarget(false);
    
    // Initialize manual muscle state
    const initialState: Record<string, number> = {};
    newCreature.muscles.forEach((muscle) => {
      initialState[muscle.id] = 0; // 0 = relaxed, 1 = contracted
    });
    setManualMuscleState(initialState);
  }, [groundY]);
  
  // Manual muscle control
  const setMuscleContraction = (muscleId: string, contraction: number) => {
    setManualMuscleState((prev) => ({
      ...prev,
      [muscleId]: Math.max(0, Math.min(1, contraction)),
    }));
  };
  
  // Apply manual muscle control
  const applyManualMuscleControl = (muscles: Muscle[]) => {
    muscles.forEach((muscle) => {
      const contraction = manualMuscleState[muscle.id] || 0;
      // Override currentLength based on manual control
      // contraction 0 = baseLength, contraction 1 = baseLength * (1 - amplitude)
      const targetContraction = contraction * muscle.amplitude;
      muscle.currentLength = muscle.baseLength * (1 - targetContraction);
    });
  };
  
  // Physics update loop
  useEffect(() => {
    if (!creature || !isRunning) {
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
      if (!creature) return;
      
      // Calculate delta time
      const deltaTime = currentTime - lastTimeRef.current;
      lastTimeRef.current = currentTime;
      
      if (deltaTime > 1000) return; // Skip large jumps
      
      // Fixed timestep physics
      timeAccumulatorRef.current += deltaTime / 1000; // Convert to seconds
      
      while (timeAccumulatorRef.current >= FIXED_TIMESTEP) {
        // Create a working copy of the creature
        const workingCreature = { ...creature };
        
        // Update manual muscle controls
        applyManualMuscleControl(workingCreature.muscles);
        
        // Update muscles (oscillation - but manual control overrides)
        updateMuscles(workingCreature.muscles, timeAccumulatorRef.current);
        
        // Apply manual control again (in case updateMuscles overwrote it)
        applyManualMuscleControl(workingCreature.muscles);
        
        // Update muscle stiffness
        workingCreature.muscles.forEach((muscle) => {
          muscle.stiffness = muscleStiffness;
        });
        
        // Verlet integration
        workingCreature.particles = integrateVerlet(
          workingCreature.particles,
          { x: 0, y: gravity },
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
        workingCreature.particles = handleGroundCollision(workingCreature.particles, {
          y: groundY,
          friction: groundFriction,
          restitution: 0.3,
        });
        
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
          setReachedTarget(true);
        }
        
        // Update creature state
        setCreature(workingCreature);
        
        timeAccumulatorRef.current -= FIXED_TIMESTEP;
      }
      
      // Render
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Render ground
      renderGround(ctx, groundY, canvas.width);
      
      // Render target zone
      renderTargetZone(ctx, targetZone);
      
      // Render creature
      if (creature) {
        renderCreature(ctx, creature);
      }
      
      // Render distance indicator
      if (creature) {
        const distance = creature.currentPos.x - creature.startPos.x;
        ctx.fillStyle = '#ffffff';
        ctx.font = '16px sans-serif';
        ctx.fillText(`Distance: ${distance.toFixed(1)}px`, 20, 30);
      }
      
      // Render success message
      if (reachedTarget) {
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
  }, [creature, isRunning, gravity, muscleStiffness, groundFriction, manualMuscleState, groundY, targetZone, reachedTarget]);
  
  // Reset creature
  const handleReset = () => {
    setIsRunning(false);
    const spawnPos = { x: 100, y: groundY - 50 };
    const newCreature = createCreatureFromTopology(STICKMAN_TOPOLOGY, undefined, spawnPos);
    setCreature(newCreature);
    setReachedTarget(false);
    
    // Reset manual muscle state
    const initialState: Record<string, number> = {};
    newCreature.muscles.forEach((muscle) => {
      initialState[muscle.id] = 0;
    });
    setManualMuscleState(initialState);
  };
  
  if (!creature) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }
  
  return (
    <div className="relative w-full h-screen bg-gray-900 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ background: '#1a1a1a' }}
      />
      
      {/* Control Panels - Top Layout */}
      <div className="absolute top-4 left-4 right-4 z-10">
        <div className="flex flex-wrap gap-4">
          {/* Main Controls */}
          <Panel title="Controls">
            <div className="space-y-3">
              {/* Start/Stop/Reset */}
              <div className="flex gap-2">
                <Button
                  onClick={() => setIsRunning(!isRunning)}
                  variant={isRunning ? 'secondary' : 'primary'}
                >
                  {isRunning ? 'Pause' : 'Start'}
                </Button>
                <Button onClick={handleReset} variant="secondary">
                  Reset
                </Button>
              </div>
              
              {/* Parameters */}
              <div className="space-y-2">
                <Slider
                  label="Gravity"
                  min={0}
                  max={200}
                  value={gravity}
                  onChange={setGravity}
                  formatValue={(v) => `${v.toFixed(1)} px/s²`}
                />
                <Slider
                  label="Muscle Stiffness"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={muscleStiffness}
                  onChange={setMuscleStiffness}
                  formatValue={(v) => `${(v * 100).toFixed(0)}%`}
                />
                <Slider
                  label="Ground Friction"
                  min={0}
                  max={1}
                  step={0.05}
                  value={groundFriction}
                  onChange={setGroundFriction}
                  formatValue={(v) => `${(v * 100).toFixed(0)}%`}
                />
              </div>
            </div>
          </Panel>
          
          {/* Muscle Controls */}
          <Panel title="Muscle Controls">
            <div className="space-y-2 max-h-64 overflow-y-auto">
              <div className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                Click and hold to contract
              </div>
              <div className="grid grid-cols-2 gap-2">
                {creature.muscles.map((muscle) => {
                  const muscleName = muscle.id
                    .replace(/-/g, ' ')
                    .replace(/\b\w/g, (l) => l.toUpperCase());
                  const contraction = manualMuscleState[muscle.id] || 0;
                  
                  return (
                    <div key={muscle.id} className="space-y-1">
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-300">
                        {muscleName}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="secondary"
                          className="flex-1 text-xs py-1"
                          onMouseDown={() => setMuscleContraction(muscle.id, 1)}
                          onMouseUp={() => setMuscleContraction(muscle.id, 0)}
                          onMouseLeave={() => setMuscleContraction(muscle.id, 0)}
                        >
                          Contract
                        </Button>
                        <div className="w-8 flex items-center justify-center text-xs text-gray-600 dark:text-gray-400">
                          {(contraction * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Panel>
          
          {/* Info Panel */}
          <Panel>
            <div className="space-y-2 text-sm min-w-[150px]">
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
                    <span className="font-medium">Max: </span>
                    <span>{creature.maxDistance.toFixed(1)}px</span>
                  </div>
                </>
              )}
              {reachedTarget && (
                <div className="text-green-600 font-bold">✓ Target Reached!</div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
