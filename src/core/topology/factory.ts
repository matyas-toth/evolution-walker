/**
 * Topology factory functions for creating and manipulating topologies.
 * @module core/topology/factory
 */

import { Topology, TopologyParticle, Vector2D } from '@/core/types';
import { validateTopology } from './validation';

/**
 * Creates a topology from JSON data
 * @param data JSON data representing a topology
 * @returns Topology object
 * @throws Error if data is invalid
 */
export function createTopologyFromJSON(data: unknown): Topology {
  // Basic type checking
  if (!data || typeof data !== 'object') {
    throw new Error('Topology data must be an object');
  }
  
  const obj = data as Record<string, unknown>;
  
  // Validate required fields
  if (typeof obj.id !== 'string') {
    throw new Error('Topology must have a string id');
  }
  if (typeof obj.name !== 'string') {
    throw new Error('Topology must have a string name');
  }
  if (!Array.isArray(obj.particles)) {
    throw new Error('Topology must have a particles array');
  }
  if (!Array.isArray(obj.constraints)) {
    throw new Error('Topology must have a constraints array');
  }
  if (!Array.isArray(obj.muscles)) {
    throw new Error('Topology must have a muscles array');
  }
  
  const topology: Topology = {
    id: obj.id,
    name: obj.name,
    particles: obj.particles as TopologyParticle[],
    constraints: obj.constraints as Topology['constraints'],
    muscles: obj.muscles as Topology['muscles'],
  };
  
  // Validate the topology
  const validation = validateTopology(topology);
  if (!validation.isValid) {
    throw new Error(`Invalid topology: ${validation.errors.join(', ')}`);
  }
  
  return topology;
}

/**
 * Creates a deep clone of a topology
 * @param topology Topology to clone
 * @returns New topology instance with copied data
 */
export function cloneTopology(topology: Topology): Topology {
  return {
    id: topology.id,
    name: topology.name,
    particles: topology.particles.map((p) => ({
      ...p,
      initialPos: { ...p.initialPos },
    })),
    constraints: topology.constraints.map((c) => ({ ...c })),
    muscles: topology.muscles.map((m) => ({ ...m })),
  };
}

/**
 * Translates all particles in a topology by an offset
 * Creates a new topology with offset positions
 * @param topology Topology to offset
 * @param offset Offset vector to apply
 * @returns New topology with offset positions
 */
export function offsetTopology(topology: Topology, offset: Vector2D): Topology {
  return {
    ...topology,
    particles: topology.particles.map((particle) => ({
      ...particle,
      initialPos: {
        x: particle.initialPos.x + offset.x,
        y: particle.initialPos.y + offset.y,
      },
    })),
  };
}
