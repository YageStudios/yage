// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { FarBake, type FarInstance } from "yage/streaming/far";

HTMLCanvasElement.prototype.getContext = (() => null) as never;

const instance = (x: number, y: number): FarInstance => {
  const under = new PIXI.Container();
  const over = new PIXI.Container();
  under.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
  over.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
  return { under, over, occluder: null, bounds: { minX: x - 5, minY: y - 5, maxX: x + 5, maxY: y + 5 } };
};

const renderer = () => ({ resolution: 1, render: vi.fn() }) as unknown as PIXI.Renderer & { render: ReturnType<typeof vi.fn> };
const view = { minX: 0, minY: 0, maxX: 99, maxY: 99 };

describe("FarBake", () => {
  it("covers the instances its chunk's picture was made with, and only under its zoom", () => {
    const far = new FarBake(100, { below: 0.2, budget: 100, pad: 0 });
    const house = instance(50, 50);
    far.add(house);
    const r = renderer();
    expect(far.update(r, 0.5, view, 0)).toBe(false);
    expect(far.covers(house)).toBe(false);
    expect(far.update(r, 0.1, view, 0)).toBe(true);
    expect(far.covers(house)).toBe(true);
    // Under then over, into the chunk's own texture.
    expect(r.render).toHaveBeenCalledTimes(2);
    expect(r.render.mock.calls[0][0]).toBe(house.under);
    // Past the zoom (with a little give) the pictures go.
    far.update(r, 0.21, view, 10);
    expect(far.covers(house)).toBe(true);
    far.update(r, 0.3, view, 20);
    expect(far.covers(house)).toBe(false);
    expect(far.root.children.length).toBe(0);
  });

  it("shows an instance added since as it is, until a stale picture's time to be made again", () => {
    const far = new FarBake(100, { below: 0.2, budget: 100, pad: 0 });
    const house = instance(50, 50);
    far.add(house);
    const r = renderer();
    far.update(r, 0.1, view, 0);
    const shed = instance(60, 60);
    far.add(shed);
    far.update(r, 0.1, view, 100);
    expect(far.covers(shed)).toBe(false);
    expect(r.render).toHaveBeenCalledTimes(2);
    far.update(r, 0.1, view, 600);
    expect(far.covers(shed)).toBe(true);
    expect(r.render).toHaveBeenCalledTimes(6);
  });

  it("shows an instance built or changed since its picture as it is, not as the picture drew it (or didn't)", () => {
    const far = new FarBake(100, { below: 0.2, budget: 100, pad: 0 });
    const house = instance(50, 50);
    const shed = { ...instance(60, 60), under: new PIXI.Container(), over: new PIXI.Container() };
    far.add(house);
    far.add(shed);
    // Built (StaticSet.build): its tree is watched from here on.
    far.changed(house);
    const r = renderer();
    far.update(r, 0.1, view, 0);
    // Nothing of the shed's was built to draw.
    expect(far.covers(house)).toBe(true);
    expect(far.covers(shed)).toBe(false);
    shed.over.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
    far.changed(shed);
    house.over.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
    expect(far.covers(house)).toBe(false);
    far.update(r, 0.1, view, 600);
    expect(far.covers(house)).toBe(true);
    expect(far.covers(shed)).toBe(true);
  });

  it("cuts each picture at its chunk, with every instance reaching into it, and hides one only where every picture it reaches has it", () => {
    const far = new FarBake(100, { below: 0.2, budget: 100, pad: 0, resolution: 0.5 });
    // Straddles chunks 0 and 1 (a tall building rising into the row behind, say).
    const tower = instance(98, 50);
    const shed = instance(150, 50);
    far.add(tower);
    far.add(shed);
    far.changed(tower);
    far.changed(shed);
    const r = renderer();
    const drawn: PIXI.Container[][] = [];
    r.render.mockImplementation((part: PIXI.Container, o: { clear: boolean }) => (o.clear ? drawn.push([part]) : drawn[drawn.length - 1].push(part)));
    // Only chunk 0's picture: chunk 1 shows as it is, the tower in it too.
    far.update(r, 0.1, { minX: -100, minY: 0, maxX: -1, maxY: 99 }, 0);
    expect(far.root.children.filter((c) => c instanceof PIXI.Sprite).map((c) => c.x)).toEqual([0]);
    expect(far.covers(tower)).toBe(false);
    far.update(r, 0.1, view, 10);
    expect(far.covers(tower)).toBe(true);
    expect(far.covers(shed)).toBe(true);
    // Chunk 1's picture has the tower stacked with the shed; each picture just its chunk.
    expect(drawn.some((parts) => parts.includes(tower.over) && parts.includes(shed.over))).toBe(true);
    const sprites = far.root.children.filter((c): c is PIXI.Sprite => c instanceof PIXI.Sprite);
    expect(sprites.map((s) => [s.x, s.texture.width])).toEqual(expect.arrayContaining([[0, 50], [100, 50]]));
  });

  it("shows every chunk a changed instance reaches as it is until their pictures are made again", () => {
    const far = new FarBake(100, { below: 0.2, budget: 100, pad: 0 });
    const tower = instance(98, 50);
    const shed = instance(150, 50);
    far.add(tower);
    far.add(shed);
    far.changed(tower);
    far.changed(shed);
    const r = renderer();
    far.update(r, 0.1, view, 0);
    expect(far.covers(shed)).toBe(true);
    tower.over.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
    // The shed's picture draws the tower as it was: the shed's chunk shows as it is, the shed with it.
    far.update(r, 0.1, view, 100);
    expect(far.covers(tower)).toBe(false);
    expect(far.covers(shed)).toBe(false);
    expect(far.root.children.filter((c) => c instanceof PIXI.Sprite).every((c) => !c.visible)).toBe(true);
    far.update(r, 0.1, view, 600);
    expect(far.covers(tower)).toBe(true);
    expect(far.covers(shed)).toBe(true);
  });

  it("makes a picture stale when the tree under an instance changes", () => {
    const far = new FarBake(100, { below: 0.2, budget: 100, pad: 0 });
    const house = instance(50, 50);
    far.add(house);
    far.changed(house);
    const r = renderer();
    far.update(r, 0.1, view, 0);
    house.over.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
    far.update(r, 0.1, view, 600);
    expect(r.render).toHaveBeenCalledTimes(4);
    far.update(r, 0.1, view, 1200);
    expect(r.render).toHaveBeenCalledTimes(4);
  });

  it("shows a chunk as it is while a roof in it is faded, and pictures its roofs whole", () => {
    const far = new FarBake(100, { below: 0.2, budget: 100, pad: 0 });
    const house = instance(50, 50);
    const shop = instance(20, 20);
    far.add(house);
    far.add(shop);
    house.over.alpha = 0.1;
    const r = renderer();
    let alphas: number[] = [];
    r.render.mockImplementation((part: PIXI.Container) => alphas.push(part.alpha));
    far.update(r, 0.1, view, 0);
    expect(alphas.every((a) => a === 1)).toBe(true);
    expect(house.over.alpha).toBe(0.1);
    // Seen faded, the whole chunk (its neighbours too) shows as it is from the next frame.
    far.covers(house);
    far.update(r, 0.1, view, 10);
    expect(far.covers(house)).toBe(false);
    expect(far.covers(shop)).toBe(false);
    expect((far.root.children[0] as PIXI.Sprite).visible).toBe(false);
    // Whole again, the picture (already made whole) is back a frame on, without being made again.
    house.over.alpha = 1;
    far.update(r, 0.1, view, 20);
    expect(far.covers(house)).toBe(false);
    far.update(r, 0.1, view, 30);
    expect(far.covers(house)).toBe(true);
    expect(far.covers(shop)).toBe(true);
    expect(r.render).toHaveBeenCalledTimes(4);
  });
});
