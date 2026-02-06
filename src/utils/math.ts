/**
 * Vector mathematics utilities for 2D operations.
 * @module utils/math
 */

import { Vector2D } from '@/core/types';

/**
 * Adds two vectors
 * @param v1 First vector
 * @param v2 Second vector
 * @returns Sum of the two vectors
 */
export function add(v1: Vector2D, v2: Vector2D): Vector2D {
  return {
    x: v1.x + v2.x,
    y: v1.y + v2.y,
  };
}

/**
 * Subtracts v2 from v1
 * @param v1 First vector
 * @param v2 Second vector
 * @returns Difference v1 - v2
 */
export function subtract(v1: Vector2D, v2: Vector2D): Vector2D {
  return {
    x: v1.x - v2.x,
    y: v1.y - v2.y,
  };
}

/**
 * Multiplies a vector by a scalar
 * @param v Vector
 * @param scalar Scalar value
 * @returns Scaled vector
 */
export function multiply(v: Vector2D, scalar: number): Vector2D {
  return {
    x: v.x * scalar,
    y: v.y * scalar,
  };
}

/**
 * Alias for multiply - scales a vector by a scalar
 * @param v Vector
 * @param scalar Scalar value
 * @returns Scaled vector
 */
export function scale(v: Vector2D, scalar: number): Vector2D {
  return multiply(v, scalar);
}

/**
 * Calculates Euclidean distance between two points
 * @param v1 First point
 * @param v2 Second point
 * @returns Distance between the points
 */
export function distance(v1: Vector2D, v2: Vector2D): number {
  const dx = v2.x - v1.x;
  const dy = v2.y - v1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates the magnitude (length) of a vector
 * @param v Vector
 * @returns Magnitude of the vector
 */
export function length(v: Vector2D): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * Normalizes a vector to unit length
 * @param v Vector to normalize
 * @returns Unit vector in the same direction (or zero vector if input is zero)
 */
export function normalize(v: Vector2D): Vector2D {
  const len = length(v);
  if (len === 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: v.x / len,
    y: v.y / len,
  };
}

/**
 * Calculates the dot product of two vectors
 * @param v1 First vector
 * @param v2 Second vector
 * @returns Dot product (scalar)
 */
export function dot(v1: Vector2D, v2: Vector2D): number {
  return v1.x * v2.x + v1.y * v2.y;
}

/**
 * Calculates the 2D cross product (returns scalar)
 * In 2D, cross product is the z-component of the 3D cross product
 * @param v1 First vector
 * @param v2 Second vector
 * @returns Cross product (scalar, represents signed area of parallelogram)
 */
export function cross(v1: Vector2D, v2: Vector2D): number {
  return v1.x * v2.y - v1.y * v2.x;
}

/**
 * Linear interpolation between two vectors
 * @param v1 Start vector
 * @param v2 End vector
 * @param t Interpolation factor (0..1)
 * @returns Interpolated vector
 */
export function lerp(v1: Vector2D, v2: Vector2D, t: number): Vector2D {
  const clampedT = Math.max(0, Math.min(1, t));
  return {
    x: v1.x + (v2.x - v1.x) * clampedT,
    y: v1.y + (v2.y - v1.y) * clampedT,
  };
}
