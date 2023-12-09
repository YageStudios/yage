import { Vector2d, rotateDegVector2d } from "./vector";

export const toWorldSpace = (position: Vector2d): Vector2d => {
  const transformedPosition = rotateDegVector2d(position, 45);
  transformedPosition.x *= Math.SQRT2;
  transformedPosition.y *= 0.5 * Math.SQRT2;
  return transformedPosition;
};
