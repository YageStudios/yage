// @vitest-environment jsdom
import { vi } from "vitest";
vi.unmock("pixi.js");
import * as PIXI from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChunkScene, MAX_SCALES, scaleUniforms, type ChunkLayerStyle } from "yage/streaming/layer";

HTMLCanvasElement.prototype.getContext = (() => null) as never;

describe("ChunkLayerStyle scales", () => {
  it("packs each range as [from, to, scale], unused slots matching no sprite", () => {
    const u = scaleUniforms([{ from: 40, to: 48, scale: 1.5 }]);
    expect(u.length).toBe(MAX_SCALES * 3);
    expect([...u.slice(0, 3)]).toEqual([40, 48, 1.5]);
    expect([...u.slice(3)].every((v) => v === 0)).toBe(true);
    expect([...scaleUniforms()].every((v) => v === 0)).toBe(true);
  });

  it("refuses more ranges than the shaders hold", () => {
    expect(() => scaleUniforms(Array.from({ length: MAX_SCALES + 1 }, (_, i) => ({ from: i, to: i + 1, scale: 2 })))).toThrow(/at most/);
  });

  it("reaches every program's uniforms: sprites, drop shadows and glows", () => {
    const style: ChunkLayerStyle = {
      atlas: PIXI.Texture.EMPTY,
      grid: [4, 4],
      size: [16, 24],
      palette: [0xffffff],
      shadow: { size: [10, 4] },
      glow: { radius: 2, ranges: [{ from: 0, to: 16, color: 0xff0000, alpha: 0.5 }] },
      scales: [{ from: 8, to: 12, scale: 1.4 }],
    };
    const scene = new ChunkScene({ chunkSize: 2048, style });
    const kind = (scene as never as { entities: { shared: PIXI.UniformGroup; shadowShared: PIXI.UniformGroup; glowShared: PIXI.UniformGroup } }).entities;
    for (const group of [kind.shared, kind.shadowShared, kind.glowShared]) expect([...(group.uniforms.uScales as Float32Array).slice(0, 3)].map((v) => +v.toFixed(3))).toEqual([8, 12, 1.4]);
  });
});
