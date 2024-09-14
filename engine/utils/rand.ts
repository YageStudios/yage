import type { Vector2d } from "./vector";
import { normalizeVector2d, scaleVector2d } from "./vector";
import seedrandom from "seedrandom";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
class Mulberry32 {
  public x = 0;
  constructor(x: number) {
    this.x = x;
  }

  call(): number {
    let z: number = (this.x += 0x6d2b79f5);
    z = (z ^ (z >> 15)) * (z | 1);
    z ^= z + (z ^ (z >> 7)) * (z | 61);
    return z ^ (z >> 14);
  }
}

export interface Random {
  number: () => number;
  int: (min: number, max?: number) => number;
  seedNumber: number;
}

const DEFAULT_SEED = 9564394382908234;

export const generate = (seedNumber: number): Random => {
  const rand = { call: seedrandom(seedNumber + "").quick };
  // const rand = new Mulberry32(seedNumber);
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
  };
};

let _random: Random = generate(DEFAULT_SEED);

export const seed = (seedNumber: number) => {
  _random = generate(seedNumber);
};

export const random = () => _random;

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
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta);
  return {
    x,
    y,
  };
};

export const randomPointOnACircle = (random: Random, radius: number): Vector2d => {
  return scaleVector2d(normalizeVector2d(randomPointInACircle(random, radius)), radius);
};
