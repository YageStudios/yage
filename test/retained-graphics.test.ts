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
/** A little rigid animal at (x, y) turned by `a`, facing `face`: a body, a limb in two segments, an eye, a shadow, a box. */
const animal = (g: PIXI.Graphics, x: number, y: number, a: number, face: number) => {
  const c = Math.cos(a), s = Math.sin(a);
  const P = (lx: number, ly: number): [number, number] => [x + face * (c * lx - s * ly), y + s * lx + c * ly];
  g.lineStyle(0).beginFill(0x000000, 0.22).drawEllipse(x, y + 1, 4, 1.5).endFill();
  g.lineStyle({ width: 0.8, color: 0x222222, alpha: 1 });
  g.beginFill(0x8a6b4f);
  g.drawPolygon([...P(-3, -1), ...P(-1, -3), ...P(2, -3.2), ...P(3.5, -1.5), ...P(2, 0), ...P(-2, 0)]);
  g.endFill();
  for (let k = 0; k < 2; k++) {
    g.lineStyle({ width: 0.6 + k * 0.2, color: k ? 0x8a6b4f : 0x222222, alpha: 0.9, ...ROUND });
    g.moveTo(...P(1, -1)).lineTo(...P(1.4, 1));
    g.moveTo(...P(1.4, 1)).lineTo(...P(2.2, 2));
  }
  g.lineStyle(0).beginFill(0x111111).drawCircle(...P(2.6, -2.4), 0.3).endFill();
  g.beginFill(0x336699, 0.5).drawRect(x - 1, y - 6, 2, 1).drawRoundedRect(x + 2, y - 6, 3, 2, 0.5).endFill();
};
const frame = (g: PIXI.Graphics, t: number) => {
  for (let i = 0; i < 12; i++) animal(g, 20 * i + t * 3.3, 7 * (i % 4) - t, 0.4 * Math.sin(t + i), i % 2 ? 1 : -1);
  g.finishPoly();
};
const stockOf = (t: number) => {
  const g = new PIXI.Graphics();
  frame(g, t);
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
