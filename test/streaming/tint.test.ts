import { describe, expect, it } from "vitest";
import { glowOf, glowUniforms, paletteArray, tintIndices, type GlowRange } from "yage/streaming/tint";

describe("tint fields", () => {
  it("unpacks a tint byte into one palette slot per field", () => {
    const fields: [number, number, number] = [8, 8, 4];
    expect(tintIndices(0, fields)).toEqual([0, 8, 16]);
    // clothes 5, hair 3, skin 2 → 5 + 3·8 + 2·64
    expect(tintIndices(5 + 24 + 128, fields)).toEqual([5, 11, 18]);
    expect(tintIndices(254, fields)).toEqual([6, 15, 19]);
  });

  it("keeps every byte inside the palette", () => {
    const fields: [number, number, number] = [8, 1, 1];
    for (let tint = 0; tint < 8; tint++) {
      const [a, b, c] = tintIndices(tint, fields);
      expect(a).toBe(tint);
      expect([b, c]).toEqual([8, 9]);
    }
  });

  it("packs palette colours as normalised rgb", () => {
    const values = paletteArray([0xff8000, 0x0000ff]);
    expect(Array.from(values.slice(0, 6))).toEqual([1, 128 / 255, 0, 0, 0, 1].map((v) => Math.fround(v)));
  });
});

describe("glow ranges", () => {
  const ranges: GlowRange[] = [
    { from: 100, to: 150, color: [0x00ff00, 0xffff00, 0xff8000, 0xff0000], alpha: 0.8, stage: { tintDivisor: 64 }, pulse: 1 },
    { from: 50, to: 100, color: 0x00ff00, alpha: 0.2 },
    { from: 200, to: 240, color: [0x0000ff, 0xffffff], alpha: 1, stage: { stride: 20 }, scale: 1.6 },
  ];

  it("packs bounds, shape and a shared ramp", () => {
    const { bounds, shape, ramp } = glowUniforms(ranges);
    expect([...bounds.subarray(0, 4)]).toEqual([100, 150, 0, 64]);
    expect([...bounds.subarray(8, 12)]).toEqual([200, 240, 20, 0]);
    // alpha, scale, stages, ramp start + pulse / 2
    expect([...shape.subarray(0, 4)].map((v) => +v.toFixed(3))).toEqual([0.8, 1, 4, 0.5]);
    expect([...shape.subarray(4, 8)].map((v) => +v.toFixed(3))).toEqual([0.2, 1, 1, 4]);
    expect([...shape.subarray(8, 12)].map((v) => +v.toFixed(3))).toEqual([1, 1.6, 2, 5]);
    expect([...ramp.subarray(3 * 3, 3 * 3 + 3)]).toEqual([1, 0, 0]);
    expect([...ramp.subarray(6 * 3, 6 * 3 + 3)]).toEqual([1, 1, 1]);
  });

  it("picks a stage by tint or by sprite offset", () => {
    expect(glowOf(ranges, 120, 0)).toEqual({ range: 0, stage: 0 });
    expect(glowOf(ranges, 120, 200)).toEqual({ range: 0, stage: 3 });
    expect(glowOf(ranges, 60, 200)).toEqual({ range: 1, stage: 0 });
    expect(glowOf(ranges, 225, 0)).toEqual({ range: 2, stage: 1 });
    expect(glowOf(ranges, 10, 0)).toBeNull();
  });
});
