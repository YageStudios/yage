// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";
import { createSnapshot, POSITION_SCALE } from "yage/streaming/protocol";

HTMLCanvasElement.prototype.getContext = (() => null) as never;

const style: ChunkLayerStyle = { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff] };

const snapshot = (tick: number, gids: number[], xs: number[]) => {
  const s = createSnapshot(0, 0, tick, gids.length);
  gids.forEach((gid, i) => { s.gid[i] = gid; s.x[i] = xs[i]; s.y[i] = 0; });
  return s;
};

describe("ChunkLayer place", () => {
  it("draws the placed entity where the page puts it, found by gid in each snapshot, and lets it go", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    scene.push(snapshot(1, [7, 8, 9], [10, 20, 30]), 0);
    const layer = scene.view(0, 0).layer!;
    const drawn = (name: string) => [...(layer.geometry.getBuffer(name).data as Int16Array).subarray(0, layer.count)];
    layer.place(8, 5, 6);
    expect(drawn("aPrevX")).toEqual([10, 5 * POSITION_SCALE, 30]);
    expect(drawn("aCurX")).toEqual([10, 5 * POSITION_SCALE, 30]);
    expect(drawn("aCurY")).toEqual([0, 6 * POSITION_SCALE, 0]);
    // The next snapshot moves gid 8 to another slot: it stays placed; the snapshot itself is untouched.
    const next = snapshot(2, [8, 9], [21, 31]);
    scene.push(next, 50);
    layer.interpolate(Infinity);
    expect(drawn("aCurX")).toEqual([5 * POSITION_SCALE, 31]);
    expect([...next.x]).toEqual([21, 31]);
    expect(drawn("aPrevX")).toEqual([5 * POSITION_SCALE, 31]);
    layer.place(-1);
    expect(drawn("aCurX")).toEqual([21, 31]);
    expect(drawn("aPrevX")).toEqual([21, 31]);
    scene.destroy();
  });
});
