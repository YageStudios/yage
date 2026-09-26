import { test, expect } from "vitest";
import { generate, randomPointOnACircle } from "yage/utils/rand";

test("float stays within [min, max]", () => {
  const rand = generate(42);
  for (let i = 0; i < 1000; i++) {
    const value = rand.float(0.5, 2);
    expect(value).toBeGreaterThanOrEqual(0.5);
    expect(value).toBeLessThanOrEqual(2);
  }
});

test("float with a single argument returns values within [0, min]", () => {
  const rand = generate(7);
  for (let i = 0; i < 1000; i++) {
    const value = rand.float(5);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(5);
  }
});

test("int is inclusive of both bounds", () => {
  const rand = generate(1234);
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const value = rand.int(0, 1);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
    seen.add(value);
  }
  expect(seen.has(0)).toBe(true);
  expect(seen.has(1)).toBe(true);
});

test("generated sequences are reproducible for the same seed", () => {
  const a = generate(99);
  const b = generate(99);
  for (let i = 0; i < 100; i++) {
    expect(a.number()).toBe(b.number());
  }
});

test("randomPointOnACircle with radius 0 stays finite", () => {
  const point = randomPointOnACircle(generate(7), 0);
  expect(Number.isFinite(point.x)).toBe(true);
  expect(Number.isFinite(point.y)).toBe(true);
});
