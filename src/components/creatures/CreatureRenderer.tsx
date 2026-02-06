/**
 * Rendering functions for creatures, particles, constraints, and environment.
 * @module components/creatures/CreatureRenderer
 */

import { Creature, Particle, Constraint, Muscle, Vector2D } from '@/core/types';

/**
 * Renders a single particle as a circle
 * @param ctx Canvas 2D context
 * @param particle Particle to render
 * @param color Optional color (defaults to white)
 */
export function renderParticle(
  ctx: CanvasRenderingContext2D,
  particle: Particle,
  color: string = '#ffffff'
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(particle.pos.x, particle.pos.y, particle.radius, 0, Math.PI * 2);
  ctx.fill();
  
  // Optional: stroke for better visibility
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Renders a constraint (bone) as a line connecting two particles
 * @param ctx Canvas 2D context
 * @param constraint Constraint to render
 * @param p1 First particle
 * @param p2 Second particle
 * @param color Optional color (defaults to gray)
 */
export function renderConstraint(
  ctx: CanvasRenderingContext2D,
  constraint: Constraint,
  p1: Particle,
  p2: Particle,
  color: string = '#888888'
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(p1.pos.x, p1.pos.y);
  ctx.lineTo(p2.pos.x, p2.pos.y);
  ctx.stroke();
}

/**
 * Renders a muscle as a thicker, colored line
 * @param ctx Canvas 2D context
 * @param muscle Muscle to render
 * @param p1 First particle
 * @param p2 Second particle
 * @param color Optional color (defaults to red)
 */
export function renderMuscle(
  ctx: CanvasRenderingContext2D,
  muscle: Muscle,
  p1: Particle,
  p2: Particle,
  color: string = '#ff4444'
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(p1.pos.x, p1.pos.y);
  ctx.lineTo(p2.pos.x, p2.pos.y);
  ctx.stroke();
  
  // Optional: Draw a small indicator for muscle state
  const midX = (p1.pos.x + p2.pos.x) / 2;
  const midY = (p1.pos.y + p2.pos.y) / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(midX, midY, 3, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Renders the ground as a horizontal line
 * @param ctx Canvas 2D context
 * @param groundY Y coordinate of ground level
 * @param width Width of the ground line
 */
export function renderGround(
  ctx: CanvasRenderingContext2D,
  groundY: number,
  width: number
): void {
  ctx.strokeStyle = '#4a5568';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(width, groundY);
  ctx.stroke();
  
  // Optional: Add a subtle fill for ground
  ctx.fillStyle = '#2d3748';
  ctx.fillRect(0, groundY, width, 10);
}

/**
 * Renders the target zone as a highlighted rectangle
 * @param ctx Canvas 2D context
 * @param targetZone Target zone definition
 */
export function renderTargetZone(
  ctx: CanvasRenderingContext2D,
  targetZone: { x: number; y: number; width: number; height: number }
): void {
  // Draw filled rectangle with transparency
  ctx.fillStyle = 'rgba(34, 197, 94, 0.3)';
  ctx.fillRect(targetZone.x, targetZone.y, targetZone.width, targetZone.height);
  
  // Draw border
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 3;
  ctx.setLineDash([5, 5]);
  ctx.strokeRect(targetZone.x, targetZone.y, targetZone.width, targetZone.height);
  ctx.setLineDash([]);
  
  // Draw label
  ctx.fillStyle = '#22c55e';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    'TARGET',
    targetZone.x + targetZone.width / 2,
    targetZone.y - 10
  );
}

/**
 * Renders a complete creature with all its particles, constraints, and muscles
 * @param ctx Canvas 2D context
 * @param creature Creature to render
 * @param scale Optional scale factor (defaults to 1)
 * @param particleColor Optional color for particles
 */
export function renderCreature(
  ctx: CanvasRenderingContext2D,
  creature: Creature,
  scale: number = 1,
  particleColor?: string
): void {
  // Save context state
  ctx.save();
  
  // Apply scale if needed
  if (scale !== 1) {
    ctx.scale(scale, scale);
  }
  
  // Create particle map for efficient lookup
  const particleMap = new Map<string, Particle>();
  creature.particles.forEach((particle) => {
    particleMap.set(particle.id, particle);
  });
  
  // Render constraints (bones) first
  creature.constraints.forEach((constraint) => {
    const p1 = particleMap.get(constraint.p1Id);
    const p2 = particleMap.get(constraint.p2Id);
    if (p1 && p2) {
      renderConstraint(ctx, constraint, p1, p2);
    }
  });
  
  // Render muscles (thicker, colored lines)
  creature.muscles.forEach((muscle) => {
    const p1 = particleMap.get(muscle.p1Id);
    const p2 = particleMap.get(muscle.p2Id);
    if (p1 && p2) {
      renderMuscle(ctx, muscle, p1, p2);
    }
  });
  
  // Render particles last (on top)
  creature.particles.forEach((particle) => {
    renderParticle(ctx, particle, particleColor);
  });
  
  // Restore context state
  ctx.restore();
}

/**
 * Renders creature from simplified data (for performance)
 * Used when only positions are available (e.g., from worker updates)
 * @param ctx Canvas 2D context
 * @param particles Array of particle positions
 * @param constraints Array of constraint definitions with particle indices
 * @param muscles Array of muscle definitions with particle indices
 * @param particleColor Optional color for particles
 */
export function renderCreatureFromPositions(
  ctx: CanvasRenderingContext2D,
  particles: Vector2D[],
  constraints: Array<{ p1Index: number; p2Index: number }>,
  muscles: Array<{ p1Index: number; p2Index: number }>,
  particleColor: string = '#ffffff'
): void {
  // Render constraints
  ctx.strokeStyle = '#888888';
  ctx.lineWidth = 2;
  constraints.forEach((constraint) => {
    const p1 = particles[constraint.p1Index];
    const p2 = particles[constraint.p2Index];
    if (p1 && p2) {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  });
  
  // Render muscles
  ctx.strokeStyle = '#ff4444';
  ctx.lineWidth = 3;
  muscles.forEach((muscle) => {
    const p1 = particles[muscle.p1Index];
    const p2 = particles[muscle.p2Index];
    if (p1 && p2) {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }
  });
  
  // Render particles
  ctx.fillStyle = particleColor;
  particles.forEach((pos) => {
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
    ctx.fill();
  });
}
