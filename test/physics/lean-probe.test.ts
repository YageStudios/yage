import { beforeAll, describe, expect, test, vi } from "vitest";
import { addFixedBox, createLeanProbe, liveLeanPhysicsWorlds, loadRapier } from "yage/physics/lean";

beforeAll(async () => {
  // test/setup.ts's fake window traps Rapier's wasm mid-step; workers and node have the real globals.
  vi.stubGlobal("window", globalThis);
  await loadRapier();
});

describe("lean probe", () => {
  test("a ball walked into a wall stops at it, and one walked along it is not slowed", () => {
    // A wall along y = 20 (its top face), the ball above it.
    const probe = createLeanProbe((state) => addFixedBox(state, 0, 30, 100, 10))!;
    const into = probe.slide(0, 10, 3, 0, 20);
    expect(into.y).toBeLessThan(7.1);
    expect(into.y).toBeGreaterThan(6.5);
    expect(Math.abs(into.x)).toBeLessThan(0.01);
    const along = probe.slide(0, 16.5, 3, 10, 0);
    expect(along.x).toBeCloseTo(10, 1);
    probe.free();
  });

  test("walked straight into a turned wall, it is redirected along it, not stuck", () => {
    // A wall turned 45°, its face crossing below the ball.
    const probe = createLeanProbe((state) => addFixedBox(state, 0, 20, 100, 10, Math.PI / 4))!;
    let x = -20, y = -40;
    for (let i = 0; i < 40; i++) {
      const m = probe.slide(x, y, 3, 0, 2);
      x += m.x;
      y += m.y;
    }
    // It reached the wall and slid along it (sideways), still making way down.
    expect(Math.abs(x + 20)).toBeGreaterThan(5);
    expect(y).toBeGreaterThan(-35);
    probe.free();
  });

  test("frees its Rapier world", () => {
    const before = liveLeanPhysicsWorlds();
    createLeanProbe(() => {})!.free();
    expect(liveLeanPhysicsWorlds()).toBe(before);
  });
});
