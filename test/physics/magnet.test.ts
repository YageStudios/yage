import { beforeAll, describe, expect, test, vi } from "vitest";
import { addFixedBox, createLeanProbe, loadRapier, type LeanProbe } from "yage/physics/lean";
import { magnetSteer } from "yage/physics/magnet";

beforeAll(async () => {
  // test/setup.ts's fake window traps Rapier's wasm mid-step; workers and node have the real globals.
  vi.stubGlobal("window", globalThis);
  await loadRapier();
});

const degrees = (v: { x: number; y: number }) => (Math.atan2(v.y, v.x) * 180) / Math.PI;

/** A hallway `width` wide running up the screen (−y) turned `turn` radians, its axis through (0, 0). */
const hallway = (turn: number, width: number) =>
  createLeanProbe((state) => {
    const c = Math.cos(turn), s = Math.sin(turn);
    // Its axis points (sin, −cos); its walls stand either side, 200 long.
    for (const side of [-1, 1]) {
      const off = side * (width / 2 + 5);
      addFixedBox(state, off * c, off * s, 5, 200, turn);
    }
  })!;

const LOOK = 40;
const RADIUS = 3.2;
const walk = (probe: LeanProbe, steps: number, magnet: boolean) => {
  let x = 0, y = 0;
  for (let i = 0; i < steps; i++) {
    const way = magnet ? magnetSteer(0, -1, (ux, uy) => probe.cast(x, y, RADIUS * 0.9, ux * LOOK, uy * LOOK)) : { x: 0, y: -1 };
    const m = probe.slide(x, y, RADIUS, way.x * 1.5, way.y * 1.5);
    x += m.x;
    y += m.y;
  }
  return { x, y };
};

describe("magnet steer", () => {
  test("walks as asked while the way is clear, normalised", () => {
    expect(magnetSteer(3, 4, () => 1)).toEqual({ x: 0.6, y: 0.8 });
    // A wall a little way off, nothing clearer near: still as asked.
    const v = magnetSteer(1, 1, () => 0.5);
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.y).toBeCloseTo(Math.SQRT1_2);
  });

  test("turns to the middle of the clear band nearest the asked way", () => {
    // Up (−90°) is walled; a clear band from −70° to −50° (a hallway turned 30°).
    const free = (ux: number, uy: number) => {
      const a = (Math.atan2(uy, ux) * 180) / Math.PI;
      return a >= -70.1 && a <= -49.9 ? 1 : 0.3;
    };
    expect(degrees(magnetSteer(0, -1, free))).toBeCloseTo(-60, 0);
    // Nothing turns it past the spread: a band only at −30° leaves the way as asked.
    expect(degrees(magnetSteer(0, -1, (ux, uy) => (Math.abs((Math.atan2(uy, ux) * 180) / Math.PI + 30) < 3 ? 1 : 0.3)))).toBeCloseTo(-90, 5);
  });

  test("a tie keeps the smaller turn, the same every time", () => {
    const free = (ux: number) => (Math.abs(ux) > 0.6 ? 1 : 0.2);
    const once = magnetSteer(0, -1, free);
    expect(magnetSteer(0, -1, free)).toEqual(once);
    expect(Math.abs(degrees(once) + 90)).toBeLessThan(50);
  });

  test("up a hallway turned 25°, the keys' up walks it along its axis instead of grinding its wall", () => {
    const probe = hallway((25 * Math.PI) / 180, 16);
    const plain = walk(probe, 60, false);
    const magnet = walk(probe, 60, true);
    const along = (p: { x: number; y: number }) => p.x * Math.sin((25 * Math.PI) / 180) - p.y * Math.cos((25 * Math.PI) / 180);
    // Straight up, the body meets the wall that steeply it sticks there; bent, it walks the whole way.
    expect(along(plain)).toBeLessThan(20);
    expect(along(magnet)).toBeGreaterThan(60 * 1.5 * 0.97);
    probe.free();
  });

  test("beside a lone turned wall, the keys' way into it turns along the wall, not off it", () => {
    // A wall leaning 20° into the keys' up (it runs up and left, at −110°), the walker just off its face on the left.
    const turn = (-20 * Math.PI) / 180;
    const probe = createLeanProbe((state) => addFixedBox(state, 5 * Math.cos(turn), 5 * Math.sin(turn), 5, 200, turn))!;
    const way = magnetSteer(0, -1, (ux, uy) => probe.cast(-3.5, 0, RADIUS * 0.9, ux * LOOK, uy * LOOK));
    // Along the wall (within a few degrees), on the walker's side of it.
    expect(degrees(way)).toBeLessThan(-109.9);
    expect(degrees(way)).toBeGreaterThan(-118);
    probe.free();
  });

  test("the cast meets walls, not bodies, and a ball against a wall still sees the way along it", () => {
    const probe = createLeanProbe((state) => addFixedBox(state, 0, 20, 100, 10))!;
    // The wall's face at y = 10: a ball of 3 at y = 0 gets 7 of a 20 move down.
    expect(probe.cast(0, 0, 3, 0, 20)).toBeCloseTo(7 / 20, 2);
    expect(probe.cast(0, 0, 3, 20, 0)).toBe(1);
    expect(probe.cast(0, 6.9, 2.7, 20, 0)).toBe(1);
    // A body standing in the way is no wall (the probe's own ball is one).
    probe.slide(10, 0, 3, 0, 0);
    expect(probe.cast(0, 0, 3, 20, 0)).toBe(1);
    probe.free();
  });
});

