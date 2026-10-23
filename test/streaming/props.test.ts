// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";
import { createSnapshot } from "yage/streaming/protocol";

// jsdom has no WebGL: Pixi only probes it for shader precision, so a null context is enough.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const style = (grid: [number, number], size: [number, number]): ChunkLayerStyle => ({ atlas: PIXI.Texture.EMPTY, grid, size, palette: [0xffffff] });

const props = (count: number) => {
  const s = createSnapshot(0, 0, 0, count);
  for (let i = 0; i < count; i++) s.sprite[i] = 300 + i;
  return s;
};

describe("ChunkScene prop sets", () => {
  it("keeps one style as set 0", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style: style([1, 1], [16, 16]), props: style([8, 4], [40, 50]) });
    scene.setProps(0, 0, props(3));
    const view = scene.views.get([...scene.views.keys()][0])!;
    expect(view.props?.count).toBe(3);
    expect(view.propSets[0]).toBe(view.props);
    expect(() => scene.setProps(0, 0, props(1), 1)).toThrow();
    scene.destroy();
  });

  it("draws each style as its own set, cleared independently", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style: style([1, 1], [16, 16]), props: [style([8, 4], [40, 50]), style([4, 4], [96, 64])] });
    scene.setProps(1, -1, props(2));
    scene.setProps(1, -1, props(5), 1);
    const view = scene.view(1, -1);
    expect(view.propSets.map((l) => l?.count)).toEqual([2, 5]);
    expect(scene.entityRoot.children.length).toBe(2);
    scene.setProps(1, -1, null, 1);
    expect(view.propSets[1]).toBeNull();
    expect(view.props?.count).toBe(2);
    scene.update({ minX: -1e5, minY: -1e5, maxX: 1e5, maxY: 1e5 });
    scene.remove(1, -1);
    expect(scene.entityRoot.children.length).toBe(0);
    scene.destroy();
  });
});
