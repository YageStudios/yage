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
    const far = new FarBake(100, { below: 0.2, budget: 100 });
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
    const far = new FarBake(100, { below: 0.2, budget: 100 });
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

  it("makes a picture stale when the tree under an instance changes", () => {
    const far = new FarBake(100, { below: 0.2, budget: 100 });
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
});
