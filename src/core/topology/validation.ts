/**
 * Topology validation functions.
 * @module core/topology/validation
 */

import { Topology } from '@/core/types';

/**
 * Validation result
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates a topology structure
 * Checks for common issues and structural problems
 * @param topology Topology to validate
 * @returns Validation result with errors and warnings
 */
export function validateTopology(topology: Topology): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Check basic structure
  if (!topology.id || topology.id.trim() === '') {
    errors.push('Topology must have a non-empty id');
  }
  
  if (!topology.name || topology.name.trim() === '') {
    errors.push('Topology must have a non-empty name');
  }
  
  if (!topology.particles || topology.particles.length === 0) {
    errors.push('Topology must have at least one particle');
  }
  
  // Validate particle IDs are unique
  const particleIdResult = validateParticleIds(topology);
  if (!particleIdResult.isValid) {
    errors.push(...particleIdResult.errors);
  }
  
  // Validate constraint particle references
  const constraintErrors = validateConstraintReferences(topology);
  errors.push(...constraintErrors);
  
  // Validate muscle particle references
  const muscleErrors = validateMuscleReferences(topology);
  errors.push(...muscleErrors);
  
  // Check if topology is connected
  if (!isConnected(topology)) {
    errors.push('Topology graph is not connected (isolated particles exist)');
  }
  
  // Check if topology has muscles
  if (!hasMuscles(topology)) {
    warnings.push('Topology has no muscles - creature will not be able to move');
  }
  
  // Check for particles with zero or negative mass
  topology.particles.forEach((particle) => {
    if (particle.mass <= 0) {
      warnings.push(`Particle ${particle.id} has non-positive mass: ${particle.mass}`);
    }
  });
  
  // Check for constraints with zero or negative rest length
  topology.constraints.forEach((constraint) => {
    if (constraint.restLength <= 0) {
      warnings.push(`Constraint ${constraint.id} has non-positive rest length: ${constraint.restLength}`);
    }
  });
  
  // Check for muscles with zero or negative base length
  topology.muscles.forEach((muscle) => {
    if (muscle.baseLength <= 0) {
      warnings.push(`Muscle ${muscle.id} has non-positive base length: ${muscle.baseLength}`);
    }
  });
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validates that all particle IDs are unique
 * @param topology Topology to validate
 * @returns Validation result
 */
export function validateParticleIds(topology: Topology): ValidationResult {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  
  topology.particles.forEach((particle) => {
    if (seenIds.has(particle.id)) {
      errors.push(`Duplicate particle ID: ${particle.id}`);
    }
    seenIds.add(particle.id);
  });
  
  return {
    isValid: errors.length === 0,
    errors,
    warnings: [],
  };
}

/**
 * Validates that all constraint particle references exist
 * @param topology Topology to validate
 * @returns Array of error messages
 */
function validateConstraintReferences(topology: Topology): string[] {
  const errors: string[] = [];
  const particleIds = new Set(topology.particles.map((p) => p.id));
  
  topology.constraints.forEach((constraint) => {
    if (!particleIds.has(constraint.p1Id)) {
      errors.push(`Constraint ${constraint.id} references non-existent particle: ${constraint.p1Id}`);
    }
    if (!particleIds.has(constraint.p2Id)) {
      errors.push(`Constraint ${constraint.id} references non-existent particle: ${constraint.p2Id}`);
    }
    if (constraint.p1Id === constraint.p2Id) {
      errors.push(`Constraint ${constraint.id} connects particle to itself`);
    }
  });
  
  return errors;
}

/**
 * Validates that all muscle particle references exist
 * @param topology Topology to validate
 * @returns Array of error messages
 */
function validateMuscleReferences(topology: Topology): string[] {
  const errors: string[] = [];
  const particleIds = new Set(topology.particles.map((p) => p.id));
  
  topology.muscles.forEach((muscle) => {
    if (!particleIds.has(muscle.p1Id)) {
      errors.push(`Muscle ${muscle.id} references non-existent particle: ${muscle.p1Id}`);
    }
    if (!particleIds.has(muscle.p2Id)) {
      errors.push(`Muscle ${muscle.id} references non-existent particle: ${muscle.p2Id}`);
    }
    if (muscle.p1Id === muscle.p2Id) {
      errors.push(`Muscle ${muscle.id} connects particle to itself`);
    }
  });
  
  return errors;
}

/**
 * Checks if the topology graph is connected
 * Uses depth-first search to verify all particles are reachable
 * @param topology Topology to check
 * @returns True if all particles are connected
 */
export function isConnected(topology: Topology): boolean {
  if (topology.particles.length === 0) {
    return false;
  }
  
  if (topology.particles.length === 1) {
    return true;
  }
  
  // Build adjacency list from constraints and muscles
  const adjacencyList = new Map<string, string[]>();
  
  topology.particles.forEach((particle) => {
    adjacencyList.set(particle.id, []);
  });
  
  // Add edges from constraints
  topology.constraints.forEach((constraint) => {
    const neighbors1 = adjacencyList.get(constraint.p1Id) || [];
    const neighbors2 = adjacencyList.get(constraint.p2Id) || [];
    neighbors1.push(constraint.p2Id);
    neighbors2.push(constraint.p1Id);
    adjacencyList.set(constraint.p1Id, neighbors1);
    adjacencyList.set(constraint.p2Id, neighbors2);
  });
  
  // Add edges from muscles
  topology.muscles.forEach((muscle) => {
    const neighbors1 = adjacencyList.get(muscle.p1Id) || [];
    const neighbors2 = adjacencyList.get(muscle.p2Id) || [];
    neighbors1.push(muscle.p2Id);
    neighbors2.push(muscle.p1Id);
    adjacencyList.set(muscle.p1Id, neighbors1);
    adjacencyList.set(muscle.p2Id, neighbors2);
  });
  
  // DFS to check connectivity
  const visited = new Set<string>();
  const stack: string[] = [topology.particles[0].id];
  
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    
    visited.add(current);
    const neighbors = adjacencyList.get(current) || [];
    neighbors.forEach((neighbor) => {
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
      }
    });
  }
  
  return visited.size === topology.particles.length;
}

/**
 * Checks if the topology has at least one muscle
 * @param topology Topology to check
 * @returns True if topology has muscles
 */
export function hasMuscles(topology: Topology): boolean {
  return topology.muscles && topology.muscles.length > 0;
}
