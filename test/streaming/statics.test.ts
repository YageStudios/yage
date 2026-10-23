// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";
import { fillPolygon, meshGeometry, type StaticSpec } from "yage/streaming/statics";
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
