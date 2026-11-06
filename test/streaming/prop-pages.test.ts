// @vitest-environment jsdom
import { vi, describe, expect, it } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { ChunkScene, type ChunkLayerStyle } from "yage/streaming/layer";
import { createSnapshot } from "yage/streaming/protocol";
HTMLCanvasElement.prototype.getContext = (() => null) as never;
const style: ChunkLayerStyle = { atlas: PIXI.Texture.EMPTY, grid: [1, 1], size: [16, 16], palette: [0xffffff] };

describe("streamed prop pages", () => {
  it("inherits lighting, retires all layers, and safely reuses a page slot", () => {
    const scene = new ChunkScene({ chunkSize: 2048, style, props: style });
    scene.setLight([0.2, 0.3, 0.4]);
    const page = scene.addPropStyle(style);
    expect(page).toBe(1);
    scene.setProps(0, 0, createSnapshot(0, 0, 0, 1), page);
    scene.setProps(1, 0, createSnapshot(1, 0, 0, 1), page);
    const layer = scene.view(0, 0).propSets[page]!;
    expect(Array.from(layer.shader.uniforms.shared.uniforms.uLight as Float32Array)).toEqual(expect.arrayContaining([expect.closeTo(0.2), expect.closeTo(0.3), expect.closeTo(0.4)]));
    scene.removePropStyle(page);
    expect(layer.destroyed).toBe(true);
    expect(scene.view(1, 0).propSets[page]).toBeNull();
    expect(() => scene.setProps(0, 0, createSnapshot(0, 0, 0, 1), page)).toThrow();
    scene.setLight([1, 1, 1]);
    expect(scene.addPropStyle(style)).toBe(page);
    scene.remove(0, 0); scene.remove(1, 0);
    scene.setProps(20, 20, null, page);
    expect(scene.views.size).toBe(0);
    expect(() => scene.removePropStyle(0)).toThrow("fixed");
    scene.destroy();
  });
});
