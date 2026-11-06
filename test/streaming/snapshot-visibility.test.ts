// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { expect, it } from "vitest";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";
import { createSnapshot } from "yage/streaming/protocol";

HTMLCanvasElement.prototype.getContext = (() => null) as never;
const style: ChunkLayerStyle = { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff] };
const bounds = { minX: 0, minY: 0, maxX: 2048, maxY: 2048 };

it("uploads a populated queued snapshot when the previous drawn chunk was empty", () => {
  const scene = new ChunkScene({ chunkSize: 2048, style });
  scene.push(createSnapshot(0, 0, 1, 0), 0);
  const populated = createSnapshot(0, 0, 2, 2);
  populated.gid.set([10, 11]);
  populated.tint.fill(0);
  scene.push(populated, 50);
  const layer = scene.view(0, 0).layer!;
  expect(layer.drawnCount).toBe(0);
  scene.update(bounds, Infinity);
  expect(layer.count).toBe(2);
  expect(layer.drawnCount).toBe(2);
  expect(layer.visible).toBe(true);
  scene.destroy();
});

it("repopulates a cached chunk after an empty interval without hiding another chunk's placed host", () => {
  const scene = new ChunkScene({ chunkSize: 2048, style });
  const crowd = createSnapshot(0, 0, 1, 2);
  crowd.gid.set([10, 11]);
  crowd.tint.fill(0);
  const host = createSnapshot(1, 0, 1, 1);
  host.gid[0] = 20;
  host.tint[0] = 0;
  scene.push(crowd, 0);
  scene.push(host, 0);
  scene.place(20, 2050, 20);
  const view = { ...bounds, maxX: 4096 };
  const crowdLayer = scene.view(0, 0).layer!;
  const hostLayer = scene.view(1, 0).layer!;
  scene.update(view, Infinity);
  expect(crowdLayer.visible).toBe(true);
  scene.push(createSnapshot(0, 0, 2, 0), 50);
  scene.update(view, Infinity);
  expect(crowdLayer.drawnCount).toBe(0);
  expect(crowdLayer.visible).toBe(false);
  expect(hostLayer.visible).toBe(true);
  scene.push({ ...crowd, tick: 3 }, 100);
  scene.update(view, Infinity);
  expect(scene.view(0, 0).layer).toBe(crowdLayer);
  expect(crowdLayer.drawnCount).toBe(2);
  expect(crowdLayer.visible).toBe(true);
  expect(hostLayer.drawnCount).toBe(1);
  expect(hostLayer.visible).toBe(true);
  scene.destroy();
});
