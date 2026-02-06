/**
 * Pre-defined stickman topology for the EvoWalker simulation.
 * @module core/topology/stickman
 */

import { Topology } from '@/core/types';

/**
 * Stickman topology definition
 * 
 * Structure:
 * - 9 particles: head, torso, 2 arms (shoulder + hand each), 2 legs (hip + foot each)
 * - 12 constraints: bones connecting the structure (includes shoulder width and head-to-shoulder support)
 * - 10 muscles: active oscillatory constraints for movement (legs, core, and arms)
 * 
 * Initial positions are relative to origin (0, 0), where:
 * - Positive Y is downward
 * - Origin is typically at ground level or spawn point
 */
export const STICKMAN_TOPOLOGY: Topology = {
  id: 'stickman',
  name: 'Stickman',
  
  particles: [
    // Head
    {
      id: 'head',
      initialPos: { x: 0, y: -40 },
      mass: 1.0,
      radius: 8,
      isLocked: false,
    },
    
    // Torso (center of body)
    {
      id: 'torso',
      initialPos: { x: 0, y: -20 },
      mass: 2.0,
      radius: 6,
      isLocked: false,
    },
    
    // Left arm
    {
      id: 'l-shoulder',
      initialPos: { x: -15, y: -25 },
      mass: 0.5,
      radius: 4,
      isLocked: false,
    },
    {
      id: 'l-hand',
      initialPos: { x: -25, y: -15 },
      mass: 0.3,
      radius: 3,
      isLocked: false,
    },
    
    // Right arm
    {
      id: 'r-shoulder',
      initialPos: { x: 15, y: -25 },
      mass: 0.5,
      radius: 4,
      isLocked: false,
    },
    {
      id: 'r-hand',
      initialPos: { x: 25, y: -15 },
      mass: 0.3,
      radius: 3,
      isLocked: false,
    },
    
    // Left leg
    {
      id: 'l-hip',
      initialPos: { x: -8, y: -5 },
      mass: 0.8,
      radius: 5,
      isLocked: false,
    },
    {
      id: 'l-foot',
      initialPos: { x: -10, y: 15 },
      mass: 0.5,
      radius: 4,
      isLocked: false,
    },
    
    // Right leg
    {
      id: 'r-hip',
      initialPos: { x: 8, y: -5 },
      mass: 0.8,
      radius: 5,
      isLocked: false,
    },
    {
      id: 'r-foot',
      initialPos: { x: 10, y: 15 },
      mass: 0.5,
      radius: 4,
      isLocked: false,
    },
  ],
  
  constraints: [
    // Core structure (bones) - rigid connections
    // Head to torso
    {
      id: 'head-torso',
      p1Id: 'head',
      p2Id: 'torso',
      restLength: 20,
      stiffness: 0.95,
      damping: 0.1,
    },
    
    // Torso to hips
    {
      id: 'torso-l-hip',
      p1Id: 'torso',
      p2Id: 'l-hip',
      restLength: 18,
      stiffness: 0.9,
      damping: 0.1,
    },
    {
      id: 'torso-r-hip',
      p1Id: 'torso',
      p2Id: 'r-hip',
      restLength: 18,
      stiffness: 0.9,
      damping: 0.1,
    },
    
    // Hips to feet
    {
      id: 'l-hip-l-foot',
      p1Id: 'l-hip',
      p2Id: 'l-foot',
      restLength: 20,
      stiffness: 0.9,
      damping: 0.1,
    },
    {
      id: 'r-hip-r-foot',
      p1Id: 'r-hip',
      p2Id: 'r-foot',
      restLength: 20,
      stiffness: 0.9,
      damping: 0.1,
    },
    
    // Torso to shoulders
    {
      id: 'torso-l-shoulder',
      p1Id: 'torso',
      p2Id: 'l-shoulder',
      restLength: 16,
      stiffness: 0.85,
      damping: 0.1,
    },
    {
      id: 'torso-r-shoulder',
      p1Id: 'torso',
      p2Id: 'r-shoulder',
      restLength: 16,
      stiffness: 0.85,
      damping: 0.1,
    },
    
    // Shoulder width constraint (prevents shoulders from collapsing inward)
    {
      id: 'l-shoulder-r-shoulder',
      p1Id: 'l-shoulder',
      p2Id: 'r-shoulder',
      restLength: 30,
      stiffness: 0.9,
      damping: 0.1,
    },
    
    // Head to shoulders (trapezius-like support, prevents shoulders from drooping)
    {
      id: 'head-l-shoulder',
      p1Id: 'head',
      p2Id: 'l-shoulder',
      restLength: 21,
      stiffness: 0.85,
      damping: 0.1,
    },
    {
      id: 'head-r-shoulder',
      p1Id: 'head',
      p2Id: 'r-shoulder',
      restLength: 21,
      stiffness: 0.85,
      damping: 0.1,
    },
    
    // Shoulders to hands
    {
      id: 'l-shoulder-l-hand',
      p1Id: 'l-shoulder',
      p2Id: 'l-hand',
      restLength: 15,
      stiffness: 0.8,
      damping: 0.1,
    },
    {
      id: 'r-shoulder-r-hand',
      p1Id: 'r-shoulder',
      p2Id: 'r-hand',
      restLength: 15,
      stiffness: 0.8,
      damping: 0.1,
    },
  ],
  
  muscles: [
    // Leg muscles (key for walking) - these will oscillate
    // Primary leg muscles (hip to foot)
    {
      id: 'l-leg-muscle-1',
      p1Id: 'l-hip',
      p2Id: 'l-foot',
      baseLength: 20,
      stiffness: 0.7,
      damping: 0.15,
    },
    {
      id: 'r-leg-muscle-1',
      p1Id: 'r-hip',
      p2Id: 'r-foot',
      baseLength: 20,
      stiffness: 0.7,
      damping: 0.15,
    },
    
    // Secondary leg muscles (torso to foot) - for balance and power
    {
      id: 'l-leg-muscle-2',
      p1Id: 'torso',
      p2Id: 'l-foot',
      baseLength: 36,
      stiffness: 0.6,
      damping: 0.15,
    },
    {
      id: 'r-leg-muscle-2',
      p1Id: 'torso',
      p2Id: 'r-foot',
      baseLength: 36,
      stiffness: 0.6,
      damping: 0.15,
    },
    
    // Core muscles (torso to hip) - for stability
    {
      id: 'core-muscle-1',
      p1Id: 'torso',
      p2Id: 'l-hip',
      baseLength: 18,
      stiffness: 0.65,
      damping: 0.15,
    },
    {
      id: 'core-muscle-2',
      p1Id: 'torso',
      p2Id: 'r-hip',
      baseLength: 18,
      stiffness: 0.65,
      damping: 0.15,
    },
    
    // Arm muscles (hip to hand for balance and coordination)
    // When contracted, pulls hand toward hip (like putting hand in pocket)
    // When relaxed, allows arm to swing forward/backward
    {
      id: 'l-arm-muscle-hip',
      p1Id: 'l-hip',
      p2Id: 'l-hand',
      baseLength: 20,
      stiffness: 0.6,
      damping: 0.15,
    },
    {
      id: 'r-arm-muscle-hip',
      p1Id: 'r-hip',
      p2Id: 'r-hand',
      baseLength: 20,
      stiffness: 0.6,
      damping: 0.15,
    },
    
    // Arm muscles (shoulder to hand for direct arm control)
    // Provides direct control over arm extension/flexion
    // When contracted, bends arm (hand toward shoulder)
    // When relaxed, extends arm
    {
      id: 'l-arm-muscle-shoulder',
      p1Id: 'l-shoulder',
      p2Id: 'l-hand',
      baseLength: 14, 
      stiffness: 0.6,
      damping: 0.15,
    },
    {
      id: 'r-arm-muscle-shoulder',
      p1Id: 'r-shoulder',
      p2Id: 'r-hand',
      baseLength: 14, 
      stiffness: 0.6,
      damping: 0.15,
    },
  ],
};
