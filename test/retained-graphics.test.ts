import * as PIXI from "pixi.js";
import { beforeAll, expect, test, vi } from "vitest";
import { RetainedGraphics, retainedStats } from "../engine/systems/render/retained-graphics";
vi.unmock("pixi.js");

beforeAll(() => {
  class Canvas {
    width = 0;
    height = 0;
    getContext = (kind: string) =>
      kind === "2d" ? { fillStyle: "", fillRect() {} } : null;
  }
  vi.stubGlobal("HTMLCanvasElement", Canvas);
  vi.stubGlobal("document", { createElement: () => new Canvas() });
});

const ROUND = { cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND };
/** A little rigid animal at (x, y) turned by `a`, facing `face`: a body, a limb in two segments, an eye, a shadow, a box.
 * Its outlines are so many screen pixels wide: 1 and 0.5 world units at zoom 1. */
const animal = (g: PIXI.Graphics, x: number, y: number, a: number, face: number, zoom: number) => {
  const c = Math.cos(a), s = Math.sin(a);
  const P = (lx: number, ly: number): [number, number] => [x + face * (c * lx - s * ly), y + s * lx + c * ly];
  g.lineStyle(0).beginFill(0x000000, 0.22).drawEllipse(x, y + 1, 4, 1.5).endFill();
  g.lineStyle({ width: 1 / zoom, color: 0x222222, alpha: 1 });
  g.beginFill(0x8a6b4f);
  g.drawPolygon([...P(-3, -1), ...P(-1, -3), ...P(2, -3.2), ...P(3.5, -1.5), ...P(2, 0), ...P(-2, 0)]);
  g.endFill();
  for (let k = 0; k < 2; k++) {
    g.lineStyle({ width: (k ? 0.5 : 1) / zoom, color: k ? 0x8a6b4f : 0x222222, alpha: 0.9, ...ROUND });
    g.moveTo(...P(1, -1)).lineTo(...P(1.4, 1));
    g.moveTo(...P(1.4, 1)).lineTo(...P(2.2, 2));
  }
  g.lineStyle(0).beginFill(0x111111).drawCircle(...P(2.6, -2.4), 0.3).endFill();
  g.beginFill(0x336699, 0.5).drawRect(x - 1, y - 6, 2, 1).drawRoundedRect(x + 2, y - 6, 3, 2, 0.5).endFill();
};
const frame = (g: PIXI.Graphics, t: number, zoom = 1) => {
  for (let i = 0; i < 12; i++) animal(g, 20 * i + t * 3.3, 7 * (i % 4) - t, 0.4 * Math.sin(t + i), i % 2 ? 1 : -1, zoom);
  g.finishPoly();
};
const stockOf = (t: number, zoom = 1) => {
  const g = new PIXI.Graphics();
  frame(g, t, zoom);
  const geo = g.geometry as unknown as { colors: number[]; points: number[]; indices: number[]; isBatchable: () => boolean };
  geo.isBatchable = () => false;
  g.geometry.updateBatches();
  const out = { points: [...geo.points], colors: Uint32Array.from(geo.colors), indices: [...geo.indices] };
  g.destroy();
  return out;
};

test("retained graphics draw the triangles Pixi would, turned and moved into place, and keep each form", () => {
  const g = new RetainedGraphics();
  for (const t of [0, 0.37, 1.9]) {
    const built = retainedStats.built;
    g.clear();
    frame(g, t);
    const mine = g.triangles(), stock = stockOf(t);
    if (t) expect(retainedStats.built).toBe(built);
    expect(mine.positions.length).toBe(stock.points.length);
    expect(mine.positions.length).toBeGreaterThan(1000);
    let worst = 0;
    for (let i = 0; i < stock.points.length; i++) worst = Math.max(worst, Math.abs(mine.positions[i] - stock.points[i]));
    expect(worst).toBeLessThan(2e-3);
    expect(Array.from(mine.indices)).toEqual(stock.indices);
    expect(Array.from(mine.colors)).toEqual(Array.from(stock.colors));
  }
  g.destroy();
});

/** The 1/16 px samples covered by the triangles (a union, as the screen shows them). */
const coverage = (pos: ArrayLike<number>, idx: ArrayLike<number>) => {
  const N = 16, cells = new Set<number>();
  for (let t = 0; t < idx.length; t += 3) {
    const [ax, ay, bx, by, cx, cy] = [idx[t], idx[t + 1], idx[t + 2]].flatMap((v) => [pos[v * 2] * N, pos[v * 2 + 1] * N]);
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!area) continue;
    for (let y = Math.floor(Math.min(ay, by, cy)); y <= Math.max(ay, by, cy); y++)
      for (let x = Math.floor(Math.min(ax, bx, cx)); x <= Math.max(ax, bx, cx); x++) {
        const px = x + 0.5, py = y + 0.5;
        const u = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area, v = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        if (u >= 0 && v >= 0 && u + v <= 1) cells.add((y + 4096) * 16384 + x + 8192);
      }
  }
  return cells;
};

test("as the zoom changes the outlines' width, nothing is tessellated again, and what is drawn covers what Pixi would", () => {
  const g = new RetainedGraphics();
  g.clear();
  frame(g, 0.5, 1);
  const built = retainedStats.built;
  for (const zoom of [0.75, 0.9, 1.1, 1.3]) {
    g.clear();
    frame(g, 0.5, zoom);
    expect(retainedStats.built).toBe(built);
    const mine = g.triangles(), stock = stockOf(0.5, zoom);
    expect(Array.from(new Set(mine.colors))).toEqual(Array.from(new Set(stock.colors)));
    const a = coverage(mine.positions, mine.indices), b = coverage(stock.points, stock.indices);
    let differ = 0;
    for (const c of a) if (!b.has(c)) differ++;
    for (const c of b) if (!a.has(c)) differ++;
    // Round caps and joins may be cut into a piece more or fewer: a sliver at their rims.
    expect(differ / b.size).toBeLessThan(1e-3);
  }
  // A square outline (no round pieces) is Pixi's own at any width.
  for (const width of [0.75, 1.2]) {
    const draw = (h: PIXI.Graphics) => h.lineStyle({ width, color: 0x222222 }).moveTo(3, 4).lineTo(5, 7).lineTo(9, 6);
    g.clear();
    draw(g);
    const s = new PIXI.Graphics();
    draw(s);
    s.finishPoly();
    (s.geometry as unknown as { isBatchable: () => boolean }).isBatchable = () => false;
    s.geometry.updateBatches();
    const points = (s.geometry as unknown as { points: number[] }).points, mine = g.triangles().positions;
    expect(mine.length).toBe(points.length);
    for (let i = 0; i < points.length; i++) expect(Math.abs(mine[i] - points[i])).toBeLessThan(2e-3);
    s.destroy();
  }
  g.destroy();
});

test("anchors follow at(), and a clear starts an empty frame", () => {
  const g = new RetainedGraphics({ anchor: true });
  g.at(5, 6);
  g.lineStyle(1, 0xff0000).moveTo(0, 0).lineTo(4, 1);
  g.at(-7, 8);
  g.beginFill(0xffffff).drawCircle(3, 3, 2).endFill();
  const { anchors, positions } = g.triangles();
  const pairs = Array.from({ length: positions.length / 2 }, (_, i) => [anchors![i * 2], anchors![i * 2 + 1]]);
  expect(pairs).toContainEqual([5, 6]);
  expect(pairs).toContainEqual([-7, 8]);
  expect(pairs.every(([x, y]) => (x === 5 && y === 6) || (x === -7 && y === 8))).toBe(true);
  g.clear();
  expect(g.triangles().positions.length).toBe(0);
  expect(() => g.beginTextureFill({ texture: PIXI.Texture.EMPTY }).drawRect(0, 0, 1, 1)).toThrow();
  g.destroy();
});
