// @vitest-environment jsdom
import { vi, expect, it } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { FarBake } from "yage/streaming/far";
import { depthMesh } from "yage/streaming/statics";
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const paint = (cx: number, cy: number, failure?: "render" | "updateTransform") => {
  const size = 2048, left = cx * size, top = cy * size;
  const far = new FarBake(size, { below: 1, pad: 0, budget: 100, resolution: .474 });
  const parent = new PIXI.Container(), under = new PIXI.Container(), over = new PIXI.Container();
  parent.position.set(-left, -top);
  under.position.set(left + 512, top + 512);
  parent.addChild(under, over);
  const sprite = new PIXI.Sprite(PIXI.Texture.EMPTY);
  sprite.width = 129.4; sprite.height = 75.9; sprite.rotation = .31;
  under.addChild(sprite);
  const occluder = depthMesh([0, 0, 129.4, 0, 129.4, 75.9, 0, 75.9], [0, 75.9, 129.4, 75.9, 129.4, 75.9, 0, 75.9], [0, 1, 2, 0, 2, 3]);
  occluder.position.copyFrom(under.position);
  const color: number[][] = [];
  let transform = new PIXI.Matrix();
  under.render = () => {
    sprite.calculateVertices();
    const vertices: Float32Array = Reflect.get(sprite, "vertexData");
    for (let i = 0; i < vertices.length; i += 2) {
      const p = transform.apply({ x: vertices[i], y: vertices[i + 1] });
      color.push([p.x, p.y]);
    }
  };
  far.add({ under, over, occluder, bounds: { minX: left + 500, minY: top + 500, maxX: left + 700, maxY: top + 700 } });
  const renderer = { resolution: 1, render: (picture: PIXI.Container, options: { transform: PIXI.Matrix }) => {
    transform = options.transform;
    const saved = picture.enableTempParent();
    picture.updateTransform(); picture.disableTempParent(saved);
    picture.render(renderer as unknown as PIXI.Renderer);
  } };
  const view = { minX: left, minY: top, maxX: left + 2047, maxY: top + 2047 };
  if (failure) {
    const originalRender = under.render, originalUpdate = under.updateTransform;
    under[failure] = () => { throw Error("distant-paint-failure"); };
    expect(() => far.update(renderer as unknown as PIXI.Renderer, .474, view, 0)).toThrow("distant-paint-failure");
    under.render = originalRender; under.updateTransform = originalUpdate;
    expect(under.position.x).toBe(left + 512); expect(under.position.y).toBe(top + 512);
    expect(under.parent).toBe(parent);
    expect(occluder.visible).toBe(true);
  }
  far.update(renderer as unknown as PIXI.Renderer, .474, view, failure ? 600 : 0);
  const depth = far.root.children.find(c => c instanceof PIXI.Mesh) as PIXI.Mesh;
  const normalized = (name: string) => Array.from(depth.geometry.getBuffer(name).data as Float32Array).map((v, i) => v + (i % 2 ? depth.y - top : depth.x - left));
  const result = { color, positions: normalized("aVertexPosition"), near: normalized("aNear"), indices: Array.from(depth.geometry.getIndex().data) };
  expect(under.position.x).toBe(left + 512); expect(under.position.y).toBe(top + 512);
  expect(under.parent).toBe(parent);
  const saved = parent.enableTempParent(); parent.updateTransform(); parent.disableTempParent(saved);
  sprite.calculateVertices();
  const restoredVertices: Float32Array = Reflect.get(sprite, "vertexData");
  expect(restoredVertices[0]).toBe(512); expect(restoredVertices[1]).toBe(512);
  far.clear(); parent.destroy({ children: true }); occluder.destroy();
  return result;
};

it.each([[-73, 171930], [-45, 172010], [16367, 171995]])("preserves actual baked quad and near-edge depth at distant chunk %i,%i", (cx, cy) => {
  const near = paint(0, 0), far = paint(cx, cy);
  expect(far.indices).toEqual(near.indices);
  for (const name of ["positions", "near"] as const) for (let i = 0; i < near[name].length; i++) expect(far[name][i]).toBeCloseTo(near[name][i], 4);
  for (let i = 0; i < near.color.length; i++) for (let axis = 0; axis < 2; axis++) expect(far.color[i][axis]).toBeCloseTo(near.color[i][axis], 5);
});


it.each(["render", "updateTransform"] as const)("restores distant part positions and permits retry when %s throws", method => {
  expect(paint(-73, 171930, method)).toEqual(paint(0, 0));
});
