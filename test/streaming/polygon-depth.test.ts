import { describe, expect, it } from "vitest";
import { footprintContains, footprintCovers, footprintSlabs, type StaticFootprint } from "yage/streaming/polygon-depth";

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const courtyard = [rect(0, 0, 100, 100), rect(30, 30, 70, 70)];
const area = (rings: StaticFootprint) =>
  rings.reduce(
    (sum, ring) =>
      sum +
      Math.abs(
        ring.reduce((a, p, i) => {
          const next = ring[(i + 1) % ring.length];
          return a + p.x * next.y - p.y * next.x;
        }, 0)
      ) /
        2,
    0
  );

describe("measured static footprint depths", () => {
  it("excludes courtyard interiors while retaining every perimeter, independent of winding", () => {
    for (const rings of [courtyard, courtyard.map((ring) => [...ring].reverse())]) {
      expect(footprintContains(rings, { x: 20, y: 50 })).toBe(true);
      expect(footprintContains(rings, { x: 50, y: 50 })).toBe(false);
      expect(footprintContains(rings, { x: 30, y: 50 })).toBe(true);
      expect(footprintContains(rings, { x: 0, y: 100 })).toBe(true);
      expect(footprintContains(rings, { x: -1, y: 50 })).toBe(false);
    }
    expect(footprintContains([], { x: 0, y: 0 })).toBe(false);
  });

  it("tests the actual rising silhouette rather than its enclosing box", () => {
    expect(footprintCovers(courtyard, { x: 50, y: 40 }, { x: 50, y: 60 })).toBe(false);
    expect(footprintCovers(courtyard, { x: 50, y: 20 }, { x: 50, y: 40 })).toBe(true);
    expect(footprintCovers(courtyard, { x: 50, y: 40 }, { x: 50, y: 80 })).toBe(true);
    expect(footprintCovers(courtyard, { x: 50, y: -10 }, { x: 50, y: 110 })).toBe(true);
    expect(footprintCovers(courtyard, { x: 110, y: -10 }, { x: 110, y: 110 })).toBe(false);
    expect(footprintCovers(courtyard, { x: -5, y: 0 }, { x: 105, y: 0 })).toBe(true);
  });

  it.each([0, 0.31, Math.PI / 2, -0.7])("preserves concave and holed roof area at angle %s", (angle) => {
    const rings = [
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 30 },
        { x: 30, y: 30 },
        { x: 30, y: 100 },
        { x: 0, y: 100 },
      ],
      rect(5, 5, 20, 20),
    ];
    const slabs = footprintSlabs(rings, angle);
    expect(area(slabs.map((slab) => slab.corners))).toBeCloseTo(5100 - 225, 5);
    expect(slabs.every((slab) => [...slab.corners, ...slab.near].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))).toBe(true);
  });

  it("keeps separate near edges across a courtyard until rising walls close the visible gap", () => {
    const slabs = footprintSlabs(courtyard, 0, 10);
    expect(area(slabs.map((slab) => slab.corners))).toBeCloseTo(9800);
    const middle = slabs.filter((slab) => slab.corners[0].x === 30 && slab.corners[1].x === 70);
    expect(middle.map((slab) => slab.near[0].y)).toEqual([30, 100]);
    expect(middle.map((slab) => [slab.corners[0].y, slab.corners[2].y])).toEqual([
      [-10, 30],
      [60, 100],
    ]);
    const bridged = footprintSlabs(courtyard, 0, 50);
    expect(area(bridged.map((slab) => slab.corners))).toBeCloseTo(15000);
  });

  it("cuts where sloped rising walls bridge a hole without filling its remaining opening", () => {
    const rings = [
      rect(0, 0, 100, 100),
      [
        { x: 20, y: 50 },
        { x: 50, y: 20 },
        { x: 80, y: 50 },
        { x: 50, y: 80 },
      ],
    ];
    const slabs = footprintSlabs(rings, 0, 20);
    // The diamond's remaining opening has diagonals 40 and 40 after a 20-pixel vertical sweep.
    expect(area(slabs.map((slab) => slab.corners))).toBeCloseTo(12000 - 800);
    expect(slabs.some((slab) => Math.abs(slab.corners[0].x - 30) < 1e-7)).toBe(true);
    expect(slabs.some((slab) => Math.abs(slab.corners[1].x - 70) < 1e-7)).toBe(true);
  });

  it("handles repeated closing vertices, empty shapes and a sprite's finite reach", () => {
    expect(footprintSlabs([], 0)).toEqual([]);
    const ring = [
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { x: 50, y: 80 },
      { x: 0, y: 60 },
      { x: 0, y: 0 },
    ];
    const slab = footprintSlabs([ring], 0, 0, 5)[0];
    expect(slab.near[0]).toEqual({ x: 0, y: 60 });
    expect(slab.near[1]).toEqual({ x: 50, y: 78 });
  });
});
