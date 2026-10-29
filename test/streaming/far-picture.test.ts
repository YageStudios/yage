// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";

// jsdom has no WebGL: Pixi only probes it for shader precision, so a null context is enough.
HTMLCanvasElement.prototype.getContext = (() => null) as never;

const style: ChunkLayerStyle = { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff] };

describe("ChunkScene far pictures", () => {
  it("draws a chunk's far picture under the ground and over the decals, each part set alone", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    const under = new PIXI.Sprite();
    const over = new PIXI.Sprite();
    scene.setFar(2, -1, under, over);
    const order = scene.root.children;
    expect(order.indexOf(scene.farUnderRoot)).toBeLessThan(order.indexOf(scene.groundRoot));
    expect(order.indexOf(scene.farOverRoot)).toBeGreaterThan(order.indexOf(scene.decalRoot));
    expect(order.indexOf(scene.farOverRoot)).toBeLessThan(order.indexOf(scene.staticRoot));
    const view = scene.view(2, -1);
    expect(view.farUnder?.position.x).toBe(2 * 2048);
    expect(view.farUnder?.position.y).toBe(-2048);
    // The ground's part goes; the buildings' stays.
    scene.setFar(2, -1, null);
    expect(under.destroyed).toBe(true);
    expect(view.farUnder).toBeNull();
    expect(view.farOver?.children[0]).toBe(over);
    scene.update({ minX: 1e5, minY: 1e5, maxX: 2e5, maxY: 2e5 });
    expect(view.farOver?.visible).toBe(false);
    scene.remove(2, -1);
    expect(over.destroyed).toBe(true);
    expect(scene.farOverRoot.children.length).toBe(0);
    scene.destroy();
  });

  it("tints far pictures with the scene's light", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style });
    scene.setLight([0.5, 0.5, 0.5]);
    const under = new PIXI.Sprite();
    scene.setFar(0, 0, under, null);
    expect(under.tint).toBe(0x808080);
    scene.setLight([1, 1, 1]);
    expect(under.tint).toBe(0xffffff);
    scene.destroy();
  });
});
