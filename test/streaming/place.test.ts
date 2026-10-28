// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";
import { createSnapshot, EMPTY_SLOT, POSITION_SCALE } from "yage/streaming/protocol";

HTMLCanvasElement.prototype.getContext = (() => null) as never;

const style: ChunkLayerStyle = { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff] };

const snapshot = (tick: number, gids: number[], xs: number[], cx = 0) => {
  const s = createSnapshot(cx, 0, tick, gids.length);
  gids.forEach((gid, i) => { s.gid[i] = gid; s.x[i] = xs[i]; s.y[i] = 0; s.sprite[i] = 10 + i; s.tint[i] = gid; });
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

  it("the scene draws it in one layer as it is handed to the next chunk: carried through the gap, never twice", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    scene.push(snapshot(1, [7, 8], [10, 20], 0), 0);
    scene.push(snapshot(1, [9], [30], 1), 0);
    const a = scene.view(0, 0).layer!, b = scene.view(1, 0).layer!;
    const drawn = (layer: typeof a, name: string) => [...(layer.geometry.getBuffer(name).data as Uint8Array | Int16Array).subarray(0, layer.drawnCount)];
    scene.place(8, 2040, 0);
    expect(drawn(a, "aCurX")).toEqual([10, 2040 * POSITION_SCALE]);
    // Handed off: gone from chunk 0's snapshot, not yet in chunk 1's. Chunk 0 draws it on, as it was.
    scene.push(snapshot(2, [7], [11], 0), 0);
    a.interpolate(Infinity);
    scene.place(8, 2050, 0);
    expect(drawn(a, "aCurX")).toEqual([11, 2050 * POSITION_SCALE]);
    expect(drawn(a, "aTint")).toEqual([7, 8]);
    expect(drawn(a, "aSprite")).toEqual([10, 11]);
    expect(b.drawnCount).toBe(1);
    // Chunk 1 has it: drawn there only.
    scene.push(snapshot(2, [9, 8], [30, 5], 1), 0);
    b.interpolate(Infinity);
    scene.place(8, 2055, 0);
    expect(a.drawnCount).toBe(1);
    expect(drawn(b, "aCurX")).toEqual([30, 7 * POSITION_SCALE]);
    // Chunk 0 a step behind still has it: hidden there, not drawn twice.
    scene.push(snapshot(3, [7, 8], [12, 2040], 0), 0);
    a.interpolate(Infinity);
    scene.place(8, 2056, 0);
    expect(drawn(a, "aTint")).toEqual([7, EMPTY_SLOT]);
    expect(drawn(b, "aCurX")).toEqual([30, 8 * POSITION_SCALE]);
    // Long gone from every snapshot: no ghost.
    scene.place(-1);
    scene.push(snapshot(40, [9], [30], 1), 0);
    b.interpolate(Infinity);
    scene.place(8, 2060, 0);
    expect(b.drawnCount).toBe(1);
    scene.destroy();
  });
});
