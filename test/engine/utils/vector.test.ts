import { describe, expect, test } from "vitest";
import { BV2, normalizeOrRandomizeVector2d, normalizeVector2d } from "yage/utils/vector";
import { generate, randomPointOnACircle } from "yage/utils/rand";

describe("normalizeVector2d", () => {
  test("maps the zero vector to the zero vector instead of NaN", () => {
    expect(normalizeVector2d({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(BV2.normalizeVector2d(0, 0)).toEqual([0, 0]);
  });

  test("keeps unit results unit-length", () => {
    const normalized = normalizeVector2d({ x: 3, y: 4 });
    expect(normalized.x).toBeCloseTo(0.6, 4);
    expect(normalized.y).toBeCloseTo(0.8, 4);
  });
});

test("randomPointOnACircle with radius 0 stays finite", () => {
  const point = randomPointOnACircle(generate(7), 0);
  expect(Number.isFinite(point.x)).toBe(true);
  expect(Number.isFinite(point.y)).toBe(true);
});

describe("normalizeOrRandomizeVector2d", () => {
  test("never returns NaN, including the degenerate random draw", () => {
    // rand.int(0, 100) === 50 makes the old fallback vector exactly (0, 0),
    // which normalized to NaN.
    const degenerate = { int: () => 50 } as any;
    const result = normalizeOrRandomizeVector2d({ x: 0, y: 0 }, degenerate);
    expect(Number.isFinite(result.x)).toBe(true);
    expect(Number.isFinite(result.y)).toBe(true);

    const rand = generate(3);
    for (let i = 0; i < 200; i++) {
      const vector = normalizeOrRandomizeVector2d({ x: 0, y: 0 }, rand);
      expect(Number.isFinite(vector.x)).toBe(true);
      expect(Number.isFinite(vector.y)).toBe(true);
    }
  });

  test("BV2 variant never returns NaN either", () => {
    const degenerate = { int: () => 50 } as any;
    const [x, y] = BV2.normalizeOrRandomizeVector2d(0, 0, degenerate);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });
});
