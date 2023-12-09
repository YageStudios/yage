/**
 * Position utils
 * @module PositionUtils
 */

import type { Vector2d } from "./vector";

/**
 * Gets a point on a circle around a position at a given angler
 *
 * @param position The Vector2d representation of a position
 * @param angle The angle of the circle the point should lie on
 * @param radius The radius of the circle
 * @returns The x/y coords of the point
 */
export function getPosAroundCircle(position: Vector2d, angle: number, radius: number): Vector2d {
  return {
    x: position.x + Math.cos(angle) * radius,
    y: position.y + Math.sin(angle) * radius,
  };
}

export const getPositionOfNextUpdate = (position: Vector2d, velocity: Vector2d): Vector2d => ({
  x: position.x + velocity.x * 1,
  y: position.y + velocity.y * 1,
});
