// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { FarBake, type FarInstance } from "yage/streaming/far";

HTMLCanvasElement.prototype.getContext = (() => null) as never;

const view = { minX: 0, minY: 0, maxX: 99, maxY: 99 };

const pictureRenderer = () => {
  const r = { resolution: 1, render: vi.fn() };
  r.render.mockImplementation((picture: PIXI.Container) => {
    const parent = picture.enableTempParent();
    try { picture.updateTransform(); }
    finally { picture.disableTempParent(parent); }
    picture.render(r as unknown as PIXI.Renderer);
  });
  return r as unknown as PIXI.Renderer & { render: ReturnType<typeof vi.fn> };
};

const instance = (name: string, z: number, paint: (name: string, part: PIXI.Container) => void): FarInstance => {
  const under = new PIXI.Container(), over = new PIXI.Container();
  for (const [part, suffix] of [[under, "under"], [over, "over"]] as const) {
    part.addChild(new PIXI.Sprite(PIXI.Texture.EMPTY));
    part.render = () => paint(`${name}:${suffix}`, part);
  }
  over.zIndex = z;
  return { under, over, occluder: null, bounds: { minX: 20, minY: 20, maxX: 70, maxY: 70 } };
};

describe("FarBake tile paint submissions", () => {
  it("submits one tile while preserving under order and stable over depth order", () => {
    const far = new FarBake(100, { below: 1, budget: 100, pad: 0 });
    const order: string[] = [];
    const a = instance("a", 2, name => order.push(name));
    const b = instance("b", 1, name => order.push(name));
    const c = instance("c", 1, name => order.push(name));
    for (const item of [a, b, c]) far.add(item);
    const r = pictureRenderer();
    far.update(r, 0.5, view, 0);
    expect(r.render).toHaveBeenCalledTimes(1);
    expect(r.render.mock.calls[0][1].clear).toBe(true);
    expect(order).toEqual(["a:under", "b:under", "c:under", "b:over", "c:over", "a:over"]);
    expect([a, b, c].every(item => far.covers(item))).toBe(true);
    expect(r.render.mock.calls[0][0].destroyed).toBe(true);
    far.clear();
  });

  it("uses standalone local transforms and whole alpha without reparenting live parts", () => {
    const far = new FarBake(100, { below: 1, budget: 100, pad: 0 });
    const recorded: { part: PIXI.Container; matrix: number[]; worldAlpha: number; childAlpha: number }[] = [];
    const item = instance("house", 0, (_name, part) => {
      const m = part.worldTransform;
      recorded.push({ part, matrix: [m.a, m.b, m.c, m.d, m.tx, m.ty], worldAlpha: part.worldAlpha, childAlpha: part.children[0].worldAlpha });
      expect(part.visible).toBe(true);
      expect(part.alpha).toBe(1);
      expect(item.occluder!.visible).toBe(false);
    });
    const occluder = new PIXI.Container();
    Object.assign(item, { occluder });
    const parent = new PIXI.Container();
    parent.position.set(8000, -7000);
    parent.scale.set(2, 3);
    parent.alpha = 0.2;
    for (const part of [item.under, item.over]) {
      part.position.set(35, 45);
      part.scale.set(0.7, 1.4);
      part.rotation = 0.3;
      part.alpha = 0.55;
      part.visible = false;
      part.children[0].alpha = 0.6;
      parent.addChild(part);
    }
    const added = vi.fn(), removed = vi.fn();
    parent.on("childAdded", added);
    parent.on("childRemoved", removed);
    far.add(item);
    far.update(pictureRenderer(), 0.5, view, 0);
    expect(recorded).toHaveLength(2);
    for (const row of recorded) {
      const m = row.part.localTransform;
      expect(row.matrix).toEqual([m.a, m.b, m.c, m.d, m.tx, m.ty]);
      expect(row.worldAlpha).toBe(1);
      expect(row.childAlpha).toBe(0.6);
      expect(row.part.parent).toBe(parent);
      expect(row.part.alpha).toBe(0.55);
      expect(row.part.visible).toBe(false);
    }
    expect(parent.children).toEqual([item.under, item.over]);
    expect(item.occluder!.visible).toBe(true);
    expect(added).not.toHaveBeenCalled();
    expect(removed).not.toHaveBeenCalled();
    far.clear();
  });

  it("clears a genuinely unbuilt tile once without drawing any part", () => {
    const far = new FarBake(100, { below: 1, budget: 100, pad: 0 });
    const item = { under: new PIXI.Container(), over: new PIXI.Container(), occluder: null, bounds: view };
    item.under.render = vi.fn();
    item.over.render = vi.fn();
    far.add(item);
    const r = pictureRenderer();
    far.update(r, 0.5, view, 0);
    expect(r.render).toHaveBeenCalledTimes(1);
    expect(r.render.mock.calls[0][1].clear).toBe(true);
    expect(item.under.render).not.toHaveBeenCalled();
    expect(item.over.render).not.toHaveBeenCalled();
    expect(far.covers(item)).toBe(false);
    expect(r.render.mock.calls[0][0].destroyed).toBe(true);
    far.clear();
  });

  it.each(["render", "updateTransform"] as const)("restores live part state and disposes the paint root if %s throws", method => {
    const far = new FarBake(100, { below: 1, budget: 100, pad: 0 });
    const item = instance("house", 0, () => {});
    const parent = new PIXI.Container();
    parent.addChild(item.under);
    item.under.visible = false;
    item.under.alpha = 0.4;
    const occluder = new PIXI.Container();
    Object.assign(item, { occluder });
    far.add(item);
    const fail = () => { throw new Error("paint failed"); };
    let restore: () => void;
    if (method === "render") {
      const original = item.under.render;
      item.under.render = fail;
      restore = () => { item.under.render = original; };
    } else {
      const original = item.under.updateTransform;
      item.under.updateTransform = fail;
      restore = () => { item.under.updateTransform = original; };
    }
    const r = pictureRenderer();
    expect(() => far.update(r, 0.5, view, 0)).toThrow("paint failed");
    expect(item.under.parent).toBe(parent);
    expect(parent.children).toEqual([item.under]);
    expect(item.under.visible).toBe(false);
    expect(item.under.alpha).toBe(0.4);
    expect(occluder.visible).toBe(true);
    expect(r.render.mock.calls[0][0].destroyed).toBe(true);
    restore();
    far.update(r, 0.5, view, 600);
    expect(far.covers(item)).toBe(true);
    far.clear();
  });
});
