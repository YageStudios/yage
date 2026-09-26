import type { Vector2d } from "./vector";
import { scaleVector2d, normalizeVector2d } from "./vector";
import { cos, sin } from "./deterministicMath";
import seedrandom from "seedrandom";

export interface Random {
  number: () => number;
  int: (min: number, max?: number) => number;
  float: (min: number, max?: number) => number;
  seedNumber: number;
}

export const generate = (seedNumber: number): Random => {
  const rand = { call: seedrandom(seedNumber + "").quick };
  return {
    seedNumber,
    number: () => rand.call(),
    int: (min: number, max?: number): number => {
      if (max === undefined) {
        max = min;
        min = 0;
      }
      return Math.floor(rand.call() * (max - min + 1)) + min;
    },
    float: (min: number, max?: number): number => {
      if (max === undefined) {
        max = min;
        min = 0;
      }
      return rand.call() * (max - min) + min;
    }
  };
};

export const randomPointOnARectangle = (random: Random, width: number, height: number): Vector2d => {
  let p = random.int(0, width + width + height + height);
  let x = 0;
  let y = 0;

  if (p < width + height) {
    if (p < width) {
      x = p;
      y = 0;
    } else {
      x = width;
      y = p - width;
    }
  } else {
    p = p - (width + height);
    if (p < width) {
      x = width - p;
      y = height;
    } else {
      x = 0;
      y = height - (p - width);
    }
  }
  return {
    x,
    y,
  };
};

export const randomPointInARectangle = (random: Random, width: number, height: number): Vector2d => {
  const x = random.int(0, width);
  const y = random.int(0, height);
  return {
    x,
    y,
  };
};

export const randomPointInACircle = (random: Random, radius: number): Vector2d => {
  const r = random.number() * radius;
  const theta = random.number() * Math.PI * 2;
  const x = r * cos(theta);
  const y = r * sin(theta);
  return {
    x,
    y,
  };
};

export const randomPointOnACircle = (random: Random, radius: number): Vector2d => {
  if (radius === 0) {
    return { x: 0, y: 0 };
  }
  return scaleVector2d(normalizeVector2d(randomPointInACircle(random, radius)), radius);
};
