// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChunkScene, POSE, type ChunkLayerStyle } from "yage/streaming/layer";
import { createSnapshot } from "yage/streaming/protocol";

HTMLCanvasElement.prototype.getContext = (() => null) as never;

const style: ChunkLayerStyle = { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff] };

describe("ChunkScene poses", () => {
  it("poses named slots, keeps the poses across snapshots and stands everyone else", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    scene.push(createSnapshot(0, 0, 1, 4), 0);
    scene.setPoses(0, 0, [{ slot: 1, pose: POSE.Lie, turn: 0.5 }, { slot: 3, pose: POSE.SitLeft, turn: 0 }, { slot: 9, pose: POSE.Sit, turn: 0 }]);
    const layer = scene.view(0, 0).layer!;
    expect([...layer.poseArray]).toEqual([0, 0, 1, 0.5, 0, 0, 3, 0]);
    // A bigger snapshot: the poses still apply, the new slots stand.
    scene.push(createSnapshot(0, 0, 2, 6), 50);
    layer.interpolate(Infinity);
    expect([...layer.poseArray]).toEqual([0, 0, 1, 0.5, 0, 0, 3, 0, 0, 0, 0, 0]);
    scene.setPoses(0, 0, []);
    expect(layer.poseArray.every((v) => v === 0)).toBe(true);
    // No layer yet: nothing to pose, nothing thrown.
    scene.setPoses(5, 5, [{ slot: 0, pose: POSE.Lie, turn: 1 }]);
    scene.destroy();
  });

  it("poses one entity by gid wherever its slot is, over its slot pose, until let go", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    const first = createSnapshot(0, 0, 1, 3);
    first.gid.set([10, 11, 12]);
    scene.push(first, 0);
    const layer = scene.view(0, 0).layer!;
    scene.setPoses(0, 0, [{ slot: 1, pose: POSE.Lie, turn: 0.5 }]);
    scene.poseEntity(11, POSE.Roll, 2);
    expect([...layer.poseArray]).toEqual([0, 0, 6, 2, 0, 0]);
    // The next snapshot has it in another slot: the pose follows it there.
    const next = createSnapshot(0, 0, 2, 3);
    next.gid.set([11, 12, 10]);
    scene.push(next, 50);
    layer.interpolate(Infinity);
    expect([...layer.poseArray]).toEqual([6, 2, 1, 0.5, 0, 0]);
    scene.poseEntity(-1);
    expect([...layer.poseArray]).toEqual([0, 0, 1, 0.5, 0, 0]);
    scene.destroy();
  });

  it("holds poses taken on a tick the drawn snapshot has not reached until it does", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    scene.push(createSnapshot(0, 0, 1, 2), 0);
    const layer = scene.view(0, 0).layer!;
    scene.push(createSnapshot(0, 0, 2, 2), 50);
    scene.setPoses(0, 0, [{ slot: 1, pose: POSE.Lie, turn: 0 }], 2);
    expect([...layer.poseArray]).toEqual([0, 0, 0, 0]);
    layer.interpolate(Infinity);
    expect([...layer.poseArray]).toEqual([0, 0, 1, 0]);
    scene.destroy();
  });
});
