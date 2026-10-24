// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";
import { createSnapshot } from "yage/streaming/protocol";

HTMLCanvasElement.prototype.getContext = (() => null) as never;

it("creates an independent pawn layer with shared style and scene depth attachments", () => {
  const scene = new ChunkScene({ chunkSize: 2048, roofDepth: true, style: { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff], shadow: { size: [10, 4], offset: [0, 0], alpha: 0.4 } } });
  const figure = scene.createPawnLayer(2, -1, 50);
  expect(scene.views.size).toBe(0);
  expect(figure.position.x).toBe(4096);
  expect(figure.position.y).toBe(-2048);
  expect(scene.entityRoot.children).toContain(figure);
  expect(scene.edgeRoot.children).toContain(figure.edges);
  expect(scene.shadowRoot.children).toContain(figure.shadow);
  expect(figure.shadow?.state.depthTest).toBe(true);
  figure.push(createSnapshot(2, -1, 3, 2), 0);
  expect(figure.count).toBe(2);
  scene.push(createSnapshot(2, -1, 3, 1), 0);
  expect(scene.view(2, -1).layer?.count).toBe(1);
  figure.destroy();
  expect(scene.view(2, -1).layer?.count).toBe(1);
  scene.destroy();
});


it("keeps independent shadow and glow uniforms consistent with the scene light", () => {
  const style: ChunkLayerStyle = { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff], shadow: { size: [10, 4], alpha: 0.4 }, glow: { radius: 8, ranges: [] } };
  const scene = new ChunkScene({ chunkSize: 2048, style });
  const figure = scene.createPawnLayer(0, 0);
  scene.setLight([0.5, 0.6, 0.7], 0.5);
  expect(figure.shadow?.shader.uniforms.shared.uniforms.uShadowAlpha).toBe(0.2);
  expect(figure.glow).not.toBeNull();
  style.shadow = undefined;
  expect(() => scene.setLight([1, 1, 1], 1)).toThrow("Chunk shadow uniforms require a shadow style");
  figure.destroy();
  scene.destroy();
});
