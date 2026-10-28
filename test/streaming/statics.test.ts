// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";
import { fillPolygon, meshGeometry, occluderSlabs, type StaticSpec } from "yage/streaming/statics";
import { meshArea, strokePolyline } from "yage/streaming/vector";

HTMLCanvasElement.prototype.getContext = (() => null) as never;

const style: ChunkLayerStyle = { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff] };
const everywhere = { minX: -1e6, minY: -1e6, maxX: 1e6, maxY: 1e6 };

const spec = (id: string, x: number, y: number, angle = 0, built?: string[]): StaticSpec => ({
  id,
  x,
  y,
  angle,
  w: 40,
  h: 20,
  build: () => {
    built?.push(id);
    return { under: new PIXI.Sprite(PIXI.Texture.EMPTY), over: new PIXI.Sprite(PIXI.Texture.EMPTY) };
  },
});

describe("ChunkScene static instances", () => {
  it("builds an instance listed by several chunks once and keeps it until the last drops it", () => {
    const scene = new ChunkScene({ chunkSize: 100, style });
    const built: string[] = [];
    scene.setStatics(0, 0, [spec("house", 90, 10, 0.3, built)]);
    scene.setStatics(1, 0, [spec("house", 90, 10, 0.3, built), spec("shed", 150, 50, 0, built)]);
    expect(built).toEqual(["house", "shed"]);
    expect(scene.staticRoot.children.length).toBe(2);
    expect(scene.overRoot.children.length).toBe(2);
    const house = scene.statics.items.get("house")!;
    expect(house.under.rotation).toBeCloseTo(0.3);
    expect(house.under.position.x).toBe(90);
    scene.remove(0, 0);
    expect(scene.statics.items.has("house")).toBe(true);
    scene.setStatics(1, 0, [spec("shed", 150, 50)]);
    expect(scene.statics.items.has("house")).toBe(false);
    expect(scene.staticRoot.children.length).toBe(1);
    scene.setStatics(1, 0, null);
    expect(scene.statics.items.size).toBe(0);
    scene.destroy();
  });

  it("finds instances under a world point in their rotated frame and culls by rotated bounds", () => {
    const scene = new ChunkScene({ chunkSize: 100, style });
    scene.setStatics(0, 0, [spec("a", 50, 50, Math.PI / 2)]);
    // Rotated a quarter turn: local x runs down the screen, local y to the left.
    expect(scene.statics.at(45, 80).map((i) => i.spec.id)).toEqual(["a"]);
    expect(scene.statics.at(55, 80)).toEqual([]);
    expect(scene.statics.at(80, 55)).toEqual([]);
    scene.update({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
    expect(scene.statics.items.get("a")!.under.visible).toBe(false);
    scene.update({ minX: 0, minY: 85, maxX: 40, maxY: 100 });
    expect(scene.statics.items.get("a")!.under.visible).toBe(true);
    scene.destroy();
  });

  it("draws decals and static parts between the ground and sprites, roofs on top, all lit", () => {
    const scene = new ChunkScene({ chunkSize: 100, style });
    const roots = scene.root.children;
    expect(roots.indexOf(scene.groundRoot)).toBeLessThan(roots.indexOf(scene.decalRoot));
    expect(roots.indexOf(scene.decalRoot)).toBeLessThan(roots.indexOf(scene.staticRoot));
    expect(roots.indexOf(scene.staticRoot)).toBeLessThan(roots.indexOf(scene.shadowRoot));
    expect(roots.indexOf(scene.overRoot)).toBe(roots.length - 1);
    const road = new PIXI.Sprite(PIXI.Texture.EMPTY);
    scene.setDecals(2, -1, [road]);
    const decals = scene.view(2, -1).decals!;
    expect(decals.position.x).toBe(200);
    expect(decals.position.y).toBe(-100);
    scene.setStatics(2, -1, [spec("b", 210, -90)]);
    scene.setLight([0.5, 0.5, 1]);
    expect(road.tint).toBe(0x8080ff);
    expect((scene.statics.items.get("b")!.over.children[0] as PIXI.Sprite).tint).toBe(0x8080ff);
    scene.update({ minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 });
    expect(decals.visible).toBe(false);
    scene.update(everywhere);
    expect(decals.visible).toBe(true);
    scene.setDecals(2, -1, null);
    expect(road.destroyed).toBe(true);
    expect(scene.decalRoot.children.length).toBe(0);
    scene.destroy();
  });

  it("stacks taller instances' over parts above lower ones, keeping listing order otherwise", () => {
    const scene = new ChunkScene({ chunkSize: 100, style });
    scene.setStatics(0, 0, [{ ...spec("tower", 10, 10), z: 6 }, spec("shed", 20, 10), { ...spec("walkup", 30, 10), z: 3 }, spec("barn", 40, 10)]);
    scene.overRoot.sortChildren();
    const order = scene.overRoot.children.map((c) => [...scene.statics.items.values()].find((i) => i.over === c)!.spec.id);
    expect(order).toEqual(["shed", "barn", "walkup", "tower"]);
    scene.destroy();
  });

  it("with depth-sorted roofs draws over parts before the sprites, each with an occluder that a faded roof drops", () => {
    const scene = new ChunkScene({ chunkSize: 100, style, roofDepth: true });
    const roots = scene.root.children;
    expect(roots.indexOf(scene.staticRoot)).toBeLessThan(roots.indexOf(scene.overRoot));
    expect(roots.indexOf(scene.overRoot)).toBeLessThan(roots.indexOf(scene.shadowRoot));
    expect(roots.indexOf(scene.overRoot)).toBeLessThan(roots.indexOf(scene.entityRoot));
    scene.setStatics(0, 0, [spec("house", 20, 20, 0.4)]);
    const house = scene.statics.items.get("house")!;
    expect(house.occluder).not.toBeNull();
    expect(house.over.children).toContain(house.occluder);
    scene.update(everywhere);
    expect(house.occluder!.visible).toBe(true);
    house.over.alpha = 0.1;
    scene.update(everywhere);
    expect(house.occluder!.visible).toBe(false);
    scene.destroy();
    const plain = new ChunkScene({ chunkSize: 100, style });
    plain.setStatics(0, 0, [spec("house", 20, 20)]);
    expect(plain.statics.items.get("house")!.occluder).toBeNull();
    plain.destroy();
  });

  it("finds instances across lookup cells, off the origin, until they are dropped", () => {
    const scene = new ChunkScene({ chunkSize: 1024, style });
    // Straddling the cell edge at x = 512, and one in negative space.
    scene.setStatics(0, 0, [spec("edge", 500, 100), spec("west", -700, -300)]);
    expect(scene.statics.at(505, 110).map((i) => i.spec.id)).toEqual(["edge"]);
    expect(scene.statics.at(535, 110).map((i) => i.spec.id)).toEqual(["edge"]);
    expect(scene.statics.at(-680, -290).map((i) => i.spec.id)).toEqual(["west"]);
    expect(scene.statics.at(700, 110)).toEqual([]);
    scene.setStatics(0, 0, [spec("west", -700, -300)]);
    expect(scene.statics.at(535, 110)).toEqual([]);
    scene.setStatics(0, 0, null);
    expect(scene.statics.at(-680, -290)).toEqual([]);
    scene.destroy();
  });

  it("built when seen, builds each instance the first time a cull finds it in view, occluder included", () => {
    const scene = new ChunkScene({ chunkSize: 100, style, roofDepth: true, buildStatics: "seen" });
    const built: string[] = [];
    scene.setStatics(0, 0, [spec("near", 10, 10, 0, built), spec("far", 90, 90, 0, built)]);
    expect(built).toEqual([]);
    const near = scene.statics.items.get("near")!;
    expect(near.bounds.maxX).toBeGreaterThan(0);
    expect(scene.statics.at(10, 10).map((i) => i.spec.id)).toEqual(["near"]);
    scene.statics.setTint(0x808080);
    scene.update({ minX: 0, minY: 0, maxX: 30, maxY: 30 });
    expect(built).toEqual(["near"]);
    expect(near.under.visible).toBe(true);
    expect(near.occluder).not.toBeNull();
    expect(near.over.children).toContain(near.occluder);
    expect((near.under.children[0] as PIXI.Sprite).tint).toBe(0x808080);
    expect(scene.statics.items.get("far")!.under.visible).toBe(false);
    scene.update(everywhere);
    scene.update(everywhere);
    expect(built).toEqual(["near", "far"]);
    scene.remove(0, 0);
    expect(scene.statics.items.size).toBe(0);
    scene.destroy();
  });

  it("built when seen within a budget, builds the nearest first and at least one per update", () => {
    // A zero budget leaves room for exactly the one guaranteed build each update.
    const scene = new ChunkScene({ chunkSize: 100, style, buildStatics: "seen", staticBudget: 0 });
    const built: string[] = [];
    scene.setStatics(0, 0, [spec("far", 300, 300, 0, built), spec("mid", 120, 120, 0, built), spec("near", -20, -10, 0, built)]);
    const view = { minX: -100, minY: -100, maxX: 400, maxY: 400 };
    scene.update({ minX: -100, minY: -100, maxX: 100, maxY: 100 });
    expect(built).toEqual(["near"]);
    scene.update(view);
    expect(built).toEqual(["near", "mid"]);
    expect(scene.statics.items.get("far")!.under.visible).toBe(false);
    scene.update(view);
    expect(built).toEqual(["near", "mid", "far"]);
    expect(scene.statics.items.get("far")!.under.visible).toBe(true);
    scene.destroy();
  });

  it("gives every roof point the depth of the footprint's near edge straight below it", () => {
    for (const angle of [0, 0.3, Math.PI / 4, 1.2, Math.PI / 2, 2.5, Math.PI, -0.7]) {
      const w = 40;
      const h = 20;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const toWorld = (p: { x: number; y: number }) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
      const corners = [toWorld({ x: 0, y: 0 }), toWorld({ x: w, y: 0 }), toWorld({ x: w, y: h }), toWorld({ x: 0, y: h })];
      // The footprint's lowest-on-screen point at world x: where its edges cross that column.
      const bottom = (x: number) => {
        let best = -Infinity;
        for (let i = 0; i < 4; i++) {
          const a = corners[i];
          const b = corners[(i + 1) % 4];
          if (x < Math.min(a.x, b.x) - 1e-3 || x > Math.max(a.x, b.x) + 1e-3) continue;
          if (Math.abs(b.x - a.x) < 1e-3) best = Math.max(best, a.y, b.y);
          else best = Math.max(best, a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
        }
        return best;
      };
      const slabs = occluderSlabs(w, h, angle);
      expect(slabs.length).toBeGreaterThan(0);
      let area = 0;
      for (const slab of slabs) {
        const pts = slab.corners.map(toWorld);
        for (let k = 0; k < 4; k++) {
          const near = toWorld(slab.near[k]);
          expect(near.x).toBeCloseTo(pts[k].x, 4);
          expect(near.y).toBeGreaterThanOrEqual(pts[k].y - 1e-6);
          expect(Math.abs(near.y - bottom(near.x))).toBeLessThan(0.1);
        }
        for (let k = 0; k < 4; k++) area += (pts[k].x * pts[(k + 1) % 4].y - pts[(k + 1) % 4].x * pts[k].y) / 2;
      }
      // The slabs tile the footprint exactly.
      expect(Math.abs(area)).toBeCloseTo(w * h, 3);
      // Risen (a building's walls and the roof on them): each strip reaches that much further up the
      // screen, at the same near-edge depth, so it covers the footprint swept up by the rise.
      const rise = 7;
      const width = Math.max(...corners.map((p) => p.x)) - Math.min(...corners.map((p) => p.x));
      let risen = 0;
      for (const [i, slab] of occluderSlabs(w, h, angle, rise).entries()) {
        const pts = slab.corners.map(toWorld);
        expect(slab.near).toEqual(slabs[i].near);
        for (let k = 0; k < 4; k++) risen += (pts[k].x * pts[(k + 1) % 4].y - pts[(k + 1) % 4].x * pts[k].y) / 2;
      }
      expect(Math.abs(risen)).toBeCloseTo(w * h + rise * width, 3);
    }
  });

  it("turns vector meshes into Pixi geometry", () => {
    const stroke = strokePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], 2);
    const g = meshGeometry(stroke);
    expect(g.getAttribute("aVertexPosition").size).toBe(2);
    expect(g.getAttribute("aUv").size).toBe(2);
    expect(g.getAttribute("aEdge").size).toBe(1);
    expect(g.getIndex().data.length).toBe(stroke.indices.length);
    const square = fillPolygon([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }]);
    expect(meshArea(square)).toBeCloseTo(12);
  });
});
