// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { DepthQuads, DEPTH_NUDGE } from "yage/streaming/depth-quads";
import { ProjectedCamera } from "yage/systems/render/ProjectedCamera";
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const buffers = (quads: DepthQuads) => Object.fromEntries(["aPos", "aUv", "aColor", "aFoot"].map(name => [name, Array.from(quads.geometry.getBuffer(name).data as Float32Array).slice(0, quads.count * (name === "aColor" ? 16 : 8))]));
const paint = (x: number, y: number, originX: number, originY: number, height = 3.2) => {
  const quads = new DepthQuads(PIXI.Texture.EMPTY);
  quads.begin(originX, originY);
  quads.quad(x, y - 6.5, 8, height, .35, .5, -.35, 0x9a7b5c, .65, x, y, { x: .25, y: .5, width: .125, height: .25 });
  quads.end();
  return quads;
};

it.each([[-73, 171930], [16367, 171995]])("packs quad vertices, depth feet and artwork locally at distant chunk %i,%i", (cx, cy) => {
  const x = cx * 2048, y = cy * 2048, near = paint(10.25, 12.5, 0, 0), far = paint(x + 10.25, y + 12.5, x, y);
  const a = buffers(near), b = buffers(far);
  for (const name of Object.keys(a)) for (let i = 0; i < a[name].length; i++) expect(b[name][i]).toBeCloseTo(a[name][i], 5);
  expect(far.position.x).toBe(x); expect(far.position.y).toBe(y);
  for (let c = 0; c < 4; c++) {
    expect(far.corner(0, c).x - x).toBeCloseTo(near.corner(0, c).x, 5);
    expect(far.corner(0, c).y - y).toBeCloseTo(near.corner(0, c).y, 5);
  }
  expect(far.state.depthTest).toBe(true); expect(far.state.depthMask).toBe(false);
  near.destroy(); far.destroy();
});

it("preserves negative-height artwork, UVs, tint, alpha and submission order", () => {
  const normal = paint(10.25, 12.5, 0, 0), flipped = paint(10.25, 12.5, 0, 0, -3.2);
  expect(buffers(flipped).aUv).toEqual(buffers(normal).aUv);
  expect(buffers(flipped).aColor).toEqual(buffers(normal).aColor);
  expect(flipped.corner(0, 0)).not.toEqual(normal.corner(0, 0));
  const indices = Array.from(flipped.geometry.getIndex().data).slice(0, 6);
  expect(indices).toEqual([0, 1, 2, 0, 2, 3]);
  normal.destroy(); flipped.destroy();
});

it("keeps default near calls, grows in order, empties and returns from an explicit origin", () => {
  const quads = new DepthQuads(PIXI.Texture.EMPTY), legacy = paint(10.25, 12.5, 0, 0);
  for (const [originX, originY] of [[0, 0], [-149504, 352112640], [0, 0]]) {
    if (originX) quads.begin(originX, originY); else quads.begin();
    for (let i = 0; i < 65; i++) quads.quad(originX + i + .25, originY + i + .5, 3.2, -3.2, .5, .5, 0, 0x123456, .75, originX + i, originY + i);
    quads.end();
    expect(quads.count).toBe(65); expect(quads.size).toBe(390); expect(quads.visible).toBe(true);
    expect(quads.position.x).toBe(originX); expect(quads.position.y).toBe(originY);
    expect(quads.corner(64, 0).x - originX).toBeCloseTo(62.65, 4);
    expect(quads.corner(64, 0).y - originY).toBeCloseTo(66.1, 4);
    expect(Array.from(quads.geometry.getIndex().data).slice(384, 390)).toEqual([256, 257, 258, 256, 258, 259]);
  }
  quads.begin(); quads.end(); expect(quads.visible).toBe(false); expect(quads.size).toBe(0);
  quads.begin(); quads.quad(10.25, 6, 8, 3.2, .35, .5, -.35, 0x9a7b5c, .65, 10.25, 12.5, { x: .25, y: .5, width: .125, height: .25 }); quads.end();
  expect(buffers(quads)).toEqual(buffers(legacy));
  quads.destroy(); legacy.destroy();
});

it.each([[0, 0], [-73, 171930], [16367, 171995]])("projects precise depth feet in front of a local pawn at chunk %i,%i", (cx, cy) => {
  const x = cx * 2048, y = cy * 2048, zoom = 2.791;
  const quads = paint(x + 10.25, y + 12.5, x, y), pawn = new PIXI.Container(); pawn.position.set(x, y);
  const camera = new ProjectedCamera(); camera.setView(zoom, 1261 / 2 - (x + 10.25) * zoom, 1303 / 2 - (y + 12.5) * zoom); camera.addChild(pawn, quads);
  const parent = camera.enableTempParent(); camera.updateTransform(); camera.disableTempParent(parent);
  let quadFoot = 0, pawnFoot = 0;
  pawn.render = renderer => { pawnFoot = renderer.projection.projectionMatrix.clone().append(pawn.worldTransform).apply({ x: 10.25, y: 12.5 }).y; };
  quads.render = renderer => { const foot = quads.geometry.getBuffer("aFoot").data as Float32Array; quadFoot = renderer.projection.projectionMatrix.clone().append(quads.worldTransform).apply({ x: foot[0], y: foot[1] }).y; };
  const renderer = { batch: { flush() {} }, globalUniforms: { update() {} }, shader: { shader: null }, projection: { projectionMatrix: new PIXI.Matrix(2 / 1261, 0, 0, -2 / 1303, -1, 1) } };
  camera.render(renderer as unknown as PIXI.Renderer);
  expect(pawnFoot).toBeCloseTo(0, 7);
  expect((quadFoot - pawnFoot) * 1303 / 2).toBeCloseTo(-DEPTH_NUDGE * zoom, 5);
  camera.destroy({ children: true });
});
