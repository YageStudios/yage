import { describe, it, expect } from "vitest";
import {
  sin,
  cos,
  tan,
  atan,
  atan2,
  exp,
  log,
  pow,
  hypot,
} from "yage/utils/deterministicMath";

const closeTo = (actual: number, expected: number, tolerance: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);

describe("deterministic trig", () => {
  const samples: number[] = [];
  for (let x = -20; x <= 20; x += 0.37) {
    samples.push(x);
  }
  samples.push(0, Math.PI, Math.PI / 2, -Math.PI / 2, 100.5, -100.5, 1000.25, 12345.678);

  it("sin matches Math.sin", () => {
    for (const x of samples) {
      closeTo(sin(x), Math.sin(x), 1e-9);
    }
  });

  it("cos matches Math.cos", () => {
    for (const x of samples) {
      closeTo(cos(x), Math.cos(x), 1e-9);
    }
  });

  it("tan matches Math.tan away from poles", () => {
    for (const x of samples) {
      if (Math.abs(Math.cos(x)) < 1e-3) {
        continue;
      }
      closeTo(tan(x), Math.tan(x), 1e-8);
    }
  });

  it("handles very large arguments within reduction error", () => {
    closeTo(sin(1e6), Math.sin(1e6), 1e-6);
    closeTo(cos(1e6), Math.cos(1e6), 1e-6);
  });
});

describe("deterministic atan/atan2", () => {
  it("atan matches Math.atan", () => {
    for (let t = -8; t <= 8; t += 0.31) {
      closeTo(atan(t), Math.atan(t), 1e-9);
    }
    closeTo(atan(0), 0, 1e-15);
    closeTo(atan(1), Math.PI / 4, 1e-12);
    closeTo(atan(-1), -Math.PI / 4, 1e-12);
    closeTo(atan(1e9), Math.atan(1e9), 1e-9);
  });

  it("atan2 matches Math.atan2 across all quadrants and axes", () => {
    const values = [-3, -1, -0.5, 0, 0.5, 1, 3];
    for (const y of values) {
      for (const x of values) {
        closeTo(atan2(y, x), Math.atan2(y, x), 1e-9);
      }
    }
    closeTo(atan2(1, 0), Math.PI / 2, 1e-12);
    closeTo(atan2(-1, 0), -Math.PI / 2, 1e-12);
    closeTo(atan2(0, -1), Math.PI, 1e-12);
    closeTo(atan2(0, 1), 0, 1e-12);
  });

  // Signed zeros are part of the atan2 spec (IEEE 754 / ECMA-262 give exact
  // values, not engine approximations), so these must match native exactly.
  it("atan2 matches Math.atan2 exactly on signed zeros and NaN", () => {
    expect(atan2(-0, -1)).toBe(Math.atan2(-0, -1)); // -PI, not +PI
    expect(atan2(0, -0)).toBe(Math.atan2(0, -0)); // PI, not PI/2
    expect(atan2(-0, -0)).toBe(Math.atan2(-0, -0)); // -PI
    expect(atan2(0, -0)).toBe(Math.PI);
    expect(atan2(-0, 1)).toBe(Math.atan2(-0, 1)); // -0
    expect(atan2(1, -0)).toBe(Math.atan2(1, -0)); // PI/2
    expect(atan2(-1, -0)).toBe(Math.atan2(-1, -0)); // -PI/2
    expect(Object.is(atan2(-0, 0), Math.atan2(-0, 0))).toBe(true); // -0
    expect(atan2(NaN, 1)).toBeNaN();
    expect(atan2(1, NaN)).toBeNaN();
    expect(atan2(0, NaN)).toBeNaN();
  });
});

describe("deterministic exp/log/pow", () => {
  it("exp matches Math.exp", () => {
    for (let x = -20; x <= 20; x += 0.37) {
      closeTo(exp(x) / Math.exp(x), 1, 1e-12);
    }
    closeTo(exp(0), 1, 1e-15);
    closeTo(exp(1), Math.E, 1e-13);
  });

  it("log matches Math.log", () => {
    for (let x = 0.001; x <= 1000; x *= 1.37) {
      closeTo(log(x), Math.log(x), 1e-11);
    }
    closeTo(log(1), 0, 1e-15);
    closeTo(log(Math.E), 1, 1e-12);
  });

  it("pow matches Math.pow", () => {
    for (const base of [0.5, 1.5, 2, 7.25, 10]) {
      for (const exponent of [-3, -1.5, 0, 0.5, 1, 2.5, 8]) {
        closeTo(pow(base, exponent) / Math.pow(base, exponent), 1, 1e-11);
      }
    }
    closeTo(pow(2, 10), 1024, 1e-12);
    expect(pow(1, 12345)).toBe(1);
    expect(pow(5, 0)).toBe(1);
  });
});

describe("deterministic hypot", () => {
  it("matches Math.hypot", () => {
    for (const [a, b] of [
      [3, 4],
      [0, 0],
      [1, 0],
      [-5, 12],
      [0.5, 0.75],
      [1e3, 2.5e3],
    ] as [number, number][]) {
      closeTo(hypot(a, b), Math.hypot(a, b), 1e-12);
    }
  });
});
