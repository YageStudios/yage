import { describe, expect, it } from "vitest";
import { clipMesh, meshArea, mergeMeshes, rotatedBounds, strokePolyline, toLocal, translateMesh, type VectorMesh } from "yage/streaming/vector";

const attr = (m: VectorMesh, name: string) => m.attributes[name].data;

describe("strokePolyline", () => {
  it("covers a straight line's rectangle with along/across attributes", () => {
    const m = strokePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2);
    expect(meshArea(m)).toBeCloseTo(40);
    const uv = attr(m, "uv");
    const edge = attr(m, "edge");
    // Three vertices across per point: left (−y side when travelling +x with y down), centre, right.
    expect(m.positions.slice(0, 6)).toEqual([0, -2, 0, 0, 0, 2]);
    expect(uv.slice(0, 6)).toEqual([0, -2, 0, 0, 0, 2]);
    expect(edge.slice(0, 3)).toEqual([2, 0, 2]);
    expect(uv[6]).toBe(10);
  });

  it("keeps the width through a right-angle miter and counts distance along", () => {
    const m = strokePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 1);
    // Two 10×2 strips sharing a 1×1 corner square twice over, minus nothing: the miter fills the outside.
    expect(meshArea(m)).toBeCloseTo(2 * 10 * 2);
    const uv = attr(m, "uv");
    expect(uv[uv.length - 2]).toBe(20);
    // The outer corner sits at the miter point (11, −1).
    expect(m.positions.slice(6, 8)).toEqual([11, -1]);
  });

  it("clamps very sharp joins to the miter limit", () => {
    const m = strokePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0.1 }], 1, { miterLimit: 3 });
    for (let i = 0; i < m.positions.length; i += 2) expect(Math.hypot(m.positions[i] - 10, m.positions[i + 1])).toBeLessThan(3.01 + 10);
    const corner = m.positions.slice(6, 12);
    for (let i = 0; i < 6; i += 2) expect(Math.hypot(corner[i] - 10, corner[i + 1])).toBeLessThanOrEqual(3 + 1e-9);
  });

  it("adds half-disc round caps with radial edge distance", () => {
    const butt = strokePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2);
    const round = strokePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2, { cap: "round", capSegments: 64 });
    expect(meshArea(round) - meshArea(butt)).toBeCloseTo(Math.PI * 4, 1);
    const xs = round.positions.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-2);
    expect(Math.max(...xs)).toBeCloseTo(12);
    const startOnly = strokePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2, { cap: ["round", "butt"], capSegments: 64 });
    expect(Math.max(...startOnly.positions.filter((_, i) => i % 2 === 0))).toBeCloseTo(10);
  });

  it("skips duplicate points and returns empty for degenerate input", () => {
    expect(strokePolyline([{ x: 1, y: 1 }, { x: 1, y: 1 }], 2).indices).toEqual([]);
    expect(meshArea(strokePolyline([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 }], 1))).toBeCloseTo(10);
  });
});

describe("clipMesh", () => {
  it("splits a line crossing a chunk border into pieces that meet exactly", () => {
    const line = strokePolyline([{ x: -30, y: 7 }, { x: 50, y: 13 }], 3, { cap: "round" });
    const left = clipMesh(line, { minX: -100, minY: -100, maxX: 20, maxY: 100 });
    const right = clipMesh(line, { minX: 20, minY: -100, maxX: 120, maxY: 100 });
    expect(meshArea(left) + meshArea(right)).toBeCloseTo(meshArea(line), 6);
    // Both sides of the cut carry the same interpolated attributes at x = 20.
    const cut = (m: VectorMesh) => {
      const out: string[] = [];
      for (let i = 0; i < m.positions.length / 2; i++) {
        if (Math.abs(m.positions[i * 2] - 20) > 1e-9) continue;
        out.push([m.positions[i * 2 + 1], ...attr(m, "uv").slice(i * 2, i * 2 + 2), attr(m, "edge")[i]].map((v) => v.toFixed(6)).join(","));
      }
      return [...new Set(out)].sort();
    };
    expect(cut(left).length).toBeGreaterThan(1);
    expect(cut(left)).toEqual(cut(right));
  });

  it("drops what is outside and keeps what is inside untouched", () => {
    const line = strokePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 1);
    expect(clipMesh(line, { minX: 20, minY: 20, maxX: 30, maxY: 30 }).indices).toEqual([]);
    const all = clipMesh(line, { minX: -5, minY: -5, maxX: 15, maxY: 5 });
    expect(meshArea(all)).toBeCloseTo(20);
    expect(all.indices.length).toBe(line.indices.length);
  });
});

describe("mesh helpers", () => {
  it("merges and translates", () => {
    const a = strokePolyline([{ x: 0, y: 0 }, { x: 1, y: 0 }], 1);
    const b = translateMesh(a, 100, 50);
    const m = mergeMeshes([a, b]);
    expect(meshArea(m)).toBeCloseTo(4);
    expect(Math.max(...m.indices)).toBe(m.positions.length / 2 - 1);
    expect(b.positions[0]).toBe(100);
    expect(b.positions[1]).toBe(49);
  });

  it("places and inverts a rotated rectangle", () => {
    const b = rotatedBounds(10, 10, 4, 2, Math.PI / 2);
    expect(b.minX).toBeCloseTo(8);
    expect(b.maxX).toBeCloseTo(10);
    expect(b.minY).toBeCloseTo(10);
    expect(b.maxY).toBeCloseTo(14);
    const p = toLocal(10, 10, Math.PI / 2, 9, 13);
    expect(p.x).toBeCloseTo(3);
    expect(p.y).toBeCloseTo(1);
  });
});
