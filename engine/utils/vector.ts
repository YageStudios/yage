/**
 * Collection of vector util functions and type definitions
 *
 * @module VectorUtils
 */
import { required, Schema, type } from "../decorators/type";
import type { Random } from "./rand";

/**
 * Type representating a two dimensional vector
 */
export type Vector2d = {
  x: number;
  y: number;
};

export type Circle2d = Vector2d & {
  radius: number;
};

export class Vector2dSchema extends Schema {
  @type("number")
  @required()
  x: number;

  @type("number")
  @required()
  y: number;
}

export const isVector2d = (v: any): v is Vector2dSchema => {
  if (typeof v !== "object") {
    return false;
  }
  return "x" in v && "y" in v;
};

const w = (v: Vector2d) => ({ x: v.x, y: v.y }); //new Vector2dSchema({ x: v.x, y: v.y });

export const BV2 = {
  lerpVector2d: (x1: number, y1: number, x2: number, y2: number, t: number): [number, number] => {
    return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
  },
  normalizeVector2d: (x: number, y: number): [number, number] => {
    const length = Math.sqrt(x * x + y * y);
    return [x / length, y / length];
  },
  rotateDegVector2d: (x: number, y: number, degrees: number): [number, number] => {
    if (degrees % 360 === 0) {
      return [x, y];
    }
    const rad = (degrees * Math.PI) / 180;
    return BV2.rotateVector2d(x, y, rad);
  },
  rotateVector2d(x: number, y: number, radians: number): [number, number] {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [x * cos - y * sin, x * sin + y * cos];
  },
  pointTowardsVector2d(x1: number, y1: number, x2: number, y2: number) {
    if (x1 === x2 && y1 === y2) {
      return [0, 1];
    }
    return BV2.normalizeVector2d(x2 - x1, y2 - y1);
  },
  normalizeOrRandomizeVector2d(x: number, y: number, rand: Random): [number, number] {
    if (x === 0 && y === 0) {
      const random = rand.int(0, 100) / 100;
      return BV2.normalizeVector2d(random - 0.5, 1 - random - 0.5);
    }
    return BV2.normalizeVector2d(x, y);
  },
  distanceSquaredVector2d(x1: number, y1: number, x2: number, y2: number): number {
    return (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
  },
  angleBetweenVector2d(x1: number, y1: number, x2: number, y2: number): number {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    return (angle * 180) / Math.PI;
  },
  multiply(x1: number, y1: number, x2: number, y2: number) {
    return [x1 * x2, y1 * y2];
  },
  scaleVector2d(x: number, y: number, scale: number): [number, number] {
    return [x * scale, y * scale];
  },
};

export const perpendicularVector2d = (v: Vector2d): Vector2d => {
  return { x: -v.y, y: v.x };
};

export const equalVector2d = (a: Vector2dSchema | Vector2d, b: Vector2dSchema | Vector2d) => a.x === b.x && a.y === b.y;

export const truncVector2d = (a: Vector2dSchema | Vector2d, trunc = 10000) => {
  return {
    x: Math.floor(a.x * trunc) / trunc,
    y: Math.floor(a.y * trunc) / trunc,
  };
};

export const clamp = (a: Vector2dSchema | Vector2d, trunc = 10000): void => {
  a.x = Math.floor(a.x * trunc) / trunc;
  a.y = Math.floor(a.y * trunc) / trunc;
};

export const trunc2d = (x: number, y: number, trunc = 10000) => {
  return {
    x: Math.floor(x * trunc) / trunc,
    y: Math.floor(y * trunc) / trunc,
  };
};

export const lerpScalar = (a: number, b: number, t: number) => a + (b - a) * t;

export const lerpVector2d = (a: Vector2dSchema | Vector2d, b: Vector2dSchema | Vector2d, t: number) => {
  return {
    x: lerpScalar(a.x, b.x, t),
    y: lerpScalar(a.y, b.y, t),
  };
};

export const distanceSquaredVector2d = (a: Vector2dSchema | Vector2d, b: Vector2dSchema | Vector2d) => {
  return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
};

export const distanceVector2d = (a: Vector2dSchema | Vector2d, b: Vector2dSchema | Vector2d): number => {
  return Math.sqrt(distanceSquaredVector2d(a, b));
};

export const inDistanceVector2d = (
  origin: Vector2dSchema | Vector2d,
  search: Vector2dSchema | Vector2d,
  distance: number
): boolean => {
  return distanceSquaredVector2d(origin, search) <= distance * distance;
};

export const inDistanceFastVector2d = (ox: number, oy: number, sx: number, sy: number, distance: number): boolean => {
  return (sx - ox) * (sx - ox) + (sy - oy) * (sy - oy) <= distance * distance;
};

export const normalizeOrRandomizeVector2d = (vector: Vector2dSchema | Vector2d, rand: Random): Vector2dSchema => {
  if (vector.x === 0 && vector.y === 0) {
    const random = rand.int(0, 100) / 100;
    return normalizeVector2d(w({ x: random - 0.5, y: 1 - random - 0.5 }));
  }
  return normalizeVector2d(vector);
};

export const lengthVector2d = (vector: Vector2dSchema | Vector2d): number => {
  return distanceVector2d(w({ x: 0, y: 0 }), vector);
};

export const rotationDegVector2d = (vector: Vector2dSchema | Vector2d): number => {
  return (rotationVector2d(vector) * 180) / Math.PI;
};

export const rotationVector2d = (vector: Vector2dSchema | Vector2d): number => {
  return Math.atan2(vector.y, vector.x);
};

export const normalizeSafeVector2d = (vector: Vector2dSchema | Vector2d): Vector2dSchema => {
  if (vector.x === 0 && vector.y === 0) {
    return w({ x: 0, y: 0 });
  }
  return normalizeVector2d(vector);
};

export const normalizeVector2d = (a: Vector2dSchema | Vector2d): Vector2dSchema => {
  const length = lengthVector2d(a);
  return w(trunc2d(a.x / length, a.y / length));
};

export const subtractVector2d = (a: Vector2dSchema | Vector2d, b: Vector2dSchema | Vector2d): Vector2dSchema => {
  return w({
    x: a.x - b.x,
    y: a.y - b.y,
  });
};

export const addVector2d = (
  a: Vector2dSchema | Vector2d,
  b: Vector2dSchema | Vector2d,
  c?: Vector2dSchema | Vector2d
): Vector2dSchema => {
  return w({
    x: a.x + b.x + (c?.x ?? 0),
    y: a.y + b.y + (c?.y ?? 0),
  });
};
export const scaleVector2d = (a: Vector2dSchema | Vector2d, scale: number): Vector2dSchema => {
  return w({
    x: a.x * scale,
    y: a.y * scale,
  });
};

export const angleOfVector2d = (a: Vector2dSchema | Vector2d): number => {
  return angleBetweenVector2d(w({ x: 1, y: 0 }), a);
};

export const angleBetweenVector2d = (a: Vector2dSchema | Vector2d, b: Vector2dSchema | Vector2d): number => {
  let angle = Math.atan2(b.y, b.x) - Math.atan2(a.y, a.x);
  if (angle < 0) {
    angle += 2 * Math.PI;
  }
  return (angle * 180) / Math.PI;
};

export const degreesFromVector2d = (a: Vector2dSchema): number => {
  return (Math.atan2(a.y, a.x) * 180) / Math.PI;
};

export const rotateDegVector2d = (a: Vector2dSchema | Vector2d, degrees: number): Vector2dSchema => {
  if (degrees % 360 === 0) {
    return w({
      ...a,
    });
  }
  const rad = (degrees * Math.PI) / 180;
  return rotateVector2d(a, rad);
};

export const multiplyVector2d = (a: Vector2dSchema | Vector2d, b: Vector2dSchema | Vector2d): Vector2dSchema =>
  w({
    x: a.x * b.x,
    y: a.y * b.y,
  });

export const dotVector2d = (a: Vector2dSchema | Vector2d, b: Vector2dSchema | Vector2d): number => {
  return a.x * b.x + a.y * b.y;
};

export const rotateVector2d = (a: Vector2dSchema | Vector2d, radians: number): Vector2dSchema => {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return w(trunc2d(a.x * cos - a.y * sin, a.x * sin + a.y * cos));
};

export const pointingTowardsVector2d = (a: Vector2dSchema | Vector2d, b: Vector2dSchema | Vector2d): boolean => {
  return dotVector2d(a, b) > 0;
};

export const pointTowardsVector2d = (
  origin: Vector2dSchema | Vector2d,
  target: (Vector2dSchema | Vector2d)[] | Vector2dSchema | Vector2d
): Vector2dSchema => {
  let dir = w({ x: 0, y: 0 });
  if (!Array.isArray(target)) {
    dir = subtractVector2d(target, origin);
  } else {
    for (const t of target) {
      dir = addVector2d(dir, subtractVector2d(t, origin));
    }
  }
  dir = normalizeVector2d(dir);
  if (isNaN(dir.x)) {
    dir = w({ x: 0, y: 0 });
  }
  return dir;
};

export const seekTowardsVector2d = (
  origin: Vector2dSchema | Vector2d,
  speed = 1,
  target: Vector2dSchema | Vector2d
) => {
  if (equalVector2d(target, origin)) {
    return origin;
  }
  const pointVector = pointTowardsVector2d(origin, target);
  return addVector2d(origin, speed > 1 ? scaleVector2d(pointVector, speed) : pointVector);
};

export const avoidVector2d = (
  origin: Vector2dSchema | Vector2d,
  speed = 1,
  target: (Vector2dSchema | Vector2d)[] | Vector2dSchema | Vector2d
) => {
  if (Array.isArray(target) && target.length === 0) {
    return origin;
  }
  const pointVector = pointTowardsVector2d(origin, target);
  return addVector2d(origin, scaleVector2d(pointVector, -speed));
};

export const isCloserVector2d = (
  origin: Vector2dSchema | Vector2d,
  a: Vector2dSchema | Vector2d,
  b: Vector2dSchema | Vector2d
): boolean => {
  const distanceA = distanceVector2d(origin, a);
  const distanceB = distanceVector2d(origin, b);
  return distanceA < distanceB;
};
