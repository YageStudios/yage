import * as PIXI from "pixi.js";
import { beforeAll, expect, test, vi } from "vitest";
import { LeanGraphics } from "../engine/systems/render/lean-graphics";
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

const draw = (g: PIXI.Graphics) => {
  for (let i = 0; i < 40; i++) {
    const c = (i * 0x2f1b37) & 0xffffff, a = [1, 0.5, 0.37, 0][i % 4];
    g.lineStyle({ width: 1 + (i % 3), color: c, alpha: a, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    g.moveTo(i, 0).lineTo(i + 7, 5).lineTo(i + 3, 9);
    g.lineStyle(0);
    g.beginFill(c ^ 0xffffff, a || undefined).drawEllipse(i * 3, 4, 3, 2).endFill();
  }
  // Colours Pixi has to parse, and a matrix fill that keeps Pixi's own UVs.
  g.beginFill("#123456", 0.25).drawRect(0, 0, 3, 3).endFill();
  g.lineStyle(2, "rgba(10, 20, 30, 0.5)").moveTo(0, 0).lineTo(4, 4);
  g.lineStyle(0);
  g.beginTextureFill({ texture: PIXI.Texture.WHITE, color: 0xff8800, matrix: new PIXI.Matrix(2, 0, 0, 2, 1, 1) }).drawRect(5, 5, 4, 4).endFill();
  g.finishPoly();
};

test("lean graphics batch the same colours, UV count, styles and vertices as Pixi's own", () => {
  const lean = new LeanGraphics(), stock = new PIXI.Graphics();
  draw(lean);
  draw(stock);
  lean.geometry.updateBatches();
  stock.geometry.updateBatches();
  const g = (x: PIXI.Graphics) => x.geometry as unknown as { colors: number[]; uvs: number[]; points: number[]; indices: number[] };
  expect(g(lean).points.length).toBeGreaterThan(400);
  expect(g(lean).points).toEqual(g(stock).points);
  expect(g(lean).indices).toEqual(g(stock).indices);
  expect(g(lean).colors).toEqual(g(stock).colors);
  expect(g(lean).uvs.length).toBe(g(stock).uvs.length);
  // The matrix rect's UVs are Pixi's.
  const tail = (x: PIXI.Graphics) => g(x).uvs.slice(-8);
  expect(tail(lean)).toEqual(tail(stock));
  const styles = (x: PIXI.Graphics) => x.geometry.graphicsData.map((d) => [d.fillStyle.color, d.fillStyle.alpha, d.fillStyle.visible, d.lineStyle.color, d.lineStyle.alpha, d.lineStyle.visible]);
  expect(styles(lean)).toEqual(styles(stock));
  lean.destroy();
  stock.destroy();
});
