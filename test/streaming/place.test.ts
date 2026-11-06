// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChunkScene, POSE, type ChunkLayerStyle } from "yage/streaming/layer";
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

  it("moving it within the same snapshot uploads its one slot, nothing else; a new snapshot lays it all out again", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    scene.push(snapshot(1, [7, 8, 9], [10, 20, 30]), 0);
    const layer = scene.view(0, 0).layer!;
    layer.place(8, 5, 6);
    const buffers = layer.geometry.buffers;
    // As if drawn: every buffer uploaded as it is now.
    for (const b of buffers) b._glBuffers[0] = { buffer: {}, updateID: b._updateID } as never;
    const ids = () => buffers.map((b) => b._updateID);
    const uploaded = ids();
    const sent: { at: number; values: number[] }[] = [];
    const gl = { ARRAY_BUFFER: 34962, bindBuffer: () => {}, bufferSubData: (_t: number, at: number, data: Int16Array) => sent.push({ at, values: [...data] }) };
    const renderer = { gl, CONTEXT_UID: 0 } as never;
    layer.place(8, 5.5, 6.5);
    expect(ids()).toEqual(uploaded);
    const drawn = (name: string) => [...(layer.geometry.getBuffer(name).data as Int16Array).subarray(0, layer.count)];
    expect(drawn("aPrevX")).toEqual([10, 5.5 * POSITION_SCALE, 30]);
    expect(drawn("aCurX")).toEqual([10, 5.5 * POSITION_SCALE, 30]);
    expect(drawn("aCurY")).toEqual([0, 6.5 * POSITION_SCALE, 0]);
    layer.flushPatches(renderer);
    expect(sent).toEqual([
      { at: 2, values: [5.5 * POSITION_SCALE] },
      { at: 2, values: [5.5 * POSITION_SCALE] },
      { at: 2, values: [6.5 * POSITION_SCALE] },
      { at: 2, values: [6.5 * POSITION_SCALE] },
    ]);
    // Not moved: nothing at all.
    sent.length = 0;
    layer.place(8, 5.5, 6.5);
    layer.flushPatches(renderer);
    expect(sent).toEqual([]);
    expect(ids()).toEqual(uploaded);
    // A new snapshot: laid out whole again, and a patch queued before it sends nothing of its own.
    layer.place(8, 6, 6.5);
    scene.push(snapshot(2, [8, 9], [21, 31]), 50);
    layer.interpolate(Infinity);
    layer.flushPatches(renderer);
    expect(sent).toEqual([]);
    expect(drawn("aCurX")).toEqual([6 * POSITION_SCALE, 31]);
    scene.destroy();
  });

  it("finds each entity's slot and its owners by gid, both while handed off, kept until the snapshot changes", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    scene.push(snapshot(1, [7, 8, 7, 9], [10, 20, 30, 40], 0), 0);
    scene.push(snapshot(1, [5, 8], [1, 2], 1), 0);
    const a = scene.view(0, 0).layer!, b = scene.view(1, 0).layer!;
    expect([a.slotOf(7), a.slotOf(8), a.slotOf(9), a.slotOf(4)]).toEqual([0, 1, 3, -1]);
    expect(a.slotOf(7, 1)).toBe(2);
    expect(a.slotOf(7, 3)).toBe(-1);
    // Past a handful of gids the snapshot is indexed whole: the same answers, the first slot winning.
    for (let gid = 100; gid < 110; gid++) expect(a.slotOf(gid)).toBe(-1);
    expect([a.slotOf(7), a.slotOf(8), a.slotOf(9)]).toEqual([0, 1, 3]);
    expect(scene.owners(8).map((o) => [o.cx, o.slot])).toEqual([[0, 1], [1, 1]]);
    expect(scene.owners(7).map((o) => [o.cx, o.slot])).toEqual([[0, 0]]);
    expect(scene.owners(-1)).toEqual([]);
    // A new snapshot: looked up again.
    scene.push(snapshot(2, [9, 8], [41, 21], 0), 50);
    a.interpolate(Infinity);
    expect([a.slotOf(7), a.slotOf(8), a.slotOf(9)]).toEqual([-1, 1, 0]);
    expect(b.slotOf(8)).toBe(1);
    expect(scene.owners(8).map((o) => [o.cx, o.slot])).toEqual([[0, 1], [1, 1]]);
    // Handed on to a chunk far from where it was last found: found by the whole-scene look once neither has it.
    scene.push(snapshot(1, [3], [1], 5), 0);
    scene.push(snapshot(3, [9], [42], 0), 100);
    scene.push(snapshot(3, [5], [1], 1), 100);
    a.interpolate(Infinity);
    b.interpolate(Infinity);
    expect(scene.owners(8)).toEqual([]);
    scene.push(snapshot(2, [3, 8], [1, 2], 5), 50);
    scene.view(5, 0).layer!.interpolate(Infinity);
    expect(scene.owners(8).map((o) => [o.cx, o.slot])).toEqual([[5, 1]]);
    scene.destroy();
  });

  it("a pose held on an entity rewrites the poses only of the layers drawing it, and only when it changes", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    scene.push(snapshot(1, [7, 8], [10, 20], 0), 0);
    scene.push(snapshot(1, [9], [30], 1), 0);
    const a = scene.view(0, 0).layer!, b = scene.view(1, 0).layer!;
    const pose = (layer: typeof a) => layer.geometry.getBuffer("aPose");
    void a.poseArray, void b.poseArray;
    const ids = () => [pose(a)._updateID, pose(b)._updateID];
    const [ua, ub] = ids();
    scene.holdPose(8, POSE.Hunch, 0.5);
    void a.poseArray, void b.poseArray;
    expect(ids()).toEqual([ua + 1, ub]);
    expect([...a.poseArray]).toEqual([0, 0, POSE.Hunch, 0.5]);
    // The same pose again: nothing rewritten.
    scene.holdPose(8, POSE.Hunch, 0.5);
    void a.poseArray, void b.poseArray;
    expect(ids()).toEqual([ua + 1, ub]);
    scene.releasePose(8);
    void a.poseArray, void b.poseArray;
    expect(ids()).toEqual([ua + 2, ub]);
    expect([...a.poseArray]).toEqual([0, 0, 0, 0]);
    scene.destroy();
  });
});
