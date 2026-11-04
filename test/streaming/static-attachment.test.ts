// @vitest-environment jsdom
import { vi, describe, expect, it } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";
import type { StaticSpec } from "yage/streaming/statics";

HTMLCanvasElement.prototype.getContext = (() => null) as never;
const style: ChunkLayerStyle = { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff] };
const visible = { minX: 0, minY: 0, maxX: 40, maxY: 20 };
const all = { minX: -1000, minY: -1000, maxX: 200000, maxY: 200000 };
const spec = (id: number, x: number, built: number[]): StaticSpec => ({
  id, x, y: 0, angle: 0, w: 40, h: 20,
  build: () => {
    built.push(id);
    return { under: new PIXI.Sprite(PIXI.Texture.EMPTY), over: new PIXI.Sprite(PIXI.Texture.EMPTY), heights: new PIXI.Sprite(PIXI.Texture.EMPTY), tops: new PIXI.Sprite(PIXI.Texture.EMPTY) };
  },
});

describe("lazy static attachment", () => {
  it("lists and picks thousands of unseen instances without attaching empty display trees", () => {
    const scene = new ChunkScene({ chunkSize: 100, style, buildStatics: "seen" });
    const built: number[] = [];
    try {
      scene.setStatics(0, 0, Array.from({ length: 2104 }, (_, id) => spec(id, id * 50, built)));
      expect(scene.statics.items.size).toBe(2104);
      expect(scene.statics.at(1, 1).map(item => item.spec.id)).toEqual([0]);
      expect(built).toEqual([]);
      for (const root of [scene.staticRoot, scene.overRoot, scene.castRoot.heights, scene.castRoot.tops]) expect(root.children).toHaveLength(0);
      scene.update(visible);
      expect(built).toEqual([0]);
      const first = scene.statics.items.get(0)!;
      expect(first.under.parent).toBe(scene.staticRoot);
      expect(first.over.parent).toBe(scene.overRoot);
      expect(first.heights.parent).toBe(scene.castRoot.heights);
      expect(first.tops.parent).toBe(scene.castRoot.tops);
      for (const root of [scene.staticRoot, scene.overRoot, scene.castRoot.heights, scene.castRoot.tops]) expect(root.children).toHaveLength(1);
    } finally { scene.destroy(); }
  });

  it("preserves listing paint order when nearer parts build first, including existing unrelated siblings", () => {
    const scene = new ChunkScene({ chunkSize: 100, style, buildStatics: "seen" });
    const built: number[] = [];
    const prefix = new PIXI.Container(), suffix = new PIXI.Container();
    try {
      scene.staticRoot.addChild(prefix);
      scene.setStatics(0, 0, [spec(0, 100, built), spec(1, 0, built)]);
      scene.statics.setTint(0x808080);
      scene.update(visible);
      scene.staticRoot.addChild(suffix);
      expect(built).toEqual([1]);
      scene.update(all);
      expect(built).toEqual([1, 0]);
      const first = scene.statics.items.get(0)!, second = scene.statics.items.get(1)!;
      expect(scene.staticRoot.children).toEqual([prefix, first.under, second.under, suffix]);
      expect(scene.overRoot.children).toEqual([first.over, second.over]);
      expect(scene.castRoot.heights.children).toEqual([first.heights, second.heights]);
      expect(scene.castRoot.tops.children).toEqual([first.tops, second.tops]);
      expect((first.under.children[0] as PIXI.Sprite).tint).toBe(0x808080);
      expect((second.over.children[0] as PIXI.Sprite).tint).toBe(0x808080);
    } finally { scene.destroy(); }
  });

  it("shares unbuilt ownership between chunks and destroys every unattached part exactly once", () => {
    const scene = new ChunkScene({ chunkSize: 100, style, buildStatics: "seen" });
    const built: number[] = [];
    try {
      const entry = spec(0, 100, built);
      scene.setStatics(0, 0, [entry]);
      scene.setStatics(1, 0, [entry]);
      const item = scene.statics.items.get(0)!;
      const parts = [item.under, item.over, item.heights, item.tops];
      const destroyed = parts.map(part => vi.spyOn(part, "destroy"));
      scene.setStatics(0, 0, null);
      expect(scene.statics.items.get(0)).toBe(item);
      expect(parts.every(part => part.parent === null && !part.destroyed)).toBe(true);
      scene.setStatics(1, 0, null);
      expect(scene.statics.items.size).toBe(0);
      expect(built).toEqual([]);
      scene.destroy();
      for (const spy of destroyed) expect(spy).toHaveBeenCalledTimes(1);
    } finally { if (!scene.root.destroyed) scene.destroy(); }
  });

  it("fully evicts built art and reconstructs fresh parts with unchanged roof depth and reveal", () => {
    const scene = new ChunkScene({ chunkSize: 100, style, buildStatics: "seen", roofDepth: true });
    const built: number[] = [];
    try {
      const entry = spec(0, 0, built);
      scene.setStatics(0, 0, [entry]); scene.update(visible);
      const before = scene.statics.items.get(0)!;
      before.over.alpha = 0.5; scene.update(visible);
      expect(before.occluder?.visible).toBe(false);
      scene.setStatics(0, 0, null);
      expect(before.under.destroyed).toBe(true);
      expect(before.over.destroyed).toBe(true);
      expect(before.occluder?.destroyed).toBe(true);
      expect(scene.statics.items.size).toBe(0);
      scene.setStatics(0, 0, [entry]); scene.update(visible);
      const after = scene.statics.items.get(0)!;
      expect(after).not.toBe(before);
      expect(after.under).not.toBe(before.under);
      expect(built).toEqual([0, 0]);
      expect(after.over.alpha).toBe(1);
      expect(after.occluder?.visible).toBe(true);
    } finally { scene.destroy(); }
  });
});
