import { createHash } from "node:crypto";
import { expect, test, vi } from "vitest";
vi.unmock("pixi.js");
import { paintSurface } from "../engine/streaming/shadow-pass";

const image = (width: number, height: number): ImageData => ({ width, height, colorSpace: "srgb", data: new Uint8ClampedArray(width * height * 4) });

/**
 * A made-up atlas (4 x 3 cells of 24 x 32 px; a fixed-seed pattern): each cell's art an opaque blob, its
 * heights a few stacked solids, some held up off the ground and some touching, with gaps between.
 */
const atlas = () => {
  const [cw, ch, cols, rows] = [24, 32, 4, 3];
  const [width, height] = [cw * cols, ch * rows];
  const art = image(width, height);
  const heights = image(width, height);
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32;
  for (let c = 0; c < cols * rows; c++) {
    const [x0, y0] = [(c % cols) * cw, Math.floor(c / cols) * ch];
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const k = 4 * ((y0 + y) * width + x0 + x);
      const r = Math.hypot(x - cw / 2, y - ch / 2.4);
      art.data[k + 3] = r < 9 + next() * 3 ? 255 : r < 13 ? 4 : 0;
    }
    for (let s = 0; s < 3; s++) {
      const [sx, sy, sw, sh] = [2 + Math.floor(next() * 14), 10 + Math.floor(next() * 16), 3 + Math.floor(next() * 6), 2 + Math.floor(next() * 5)];
      const base = s === 1 ? Math.floor(next() * 6) : 0, top = base + 1 + Math.floor(next() * 12);
      for (let y = sy; y < Math.min(ch, sy + sh); y++) for (let x = sx; x < Math.min(cw, sx + sw); x++) {
        const k = 4 * ((y0 + y) * width + x0 + x);
        [heights.data[k], heights.data[k + 1], heights.data[k + 2], heights.data[k + 3]] = [top, base, s + 1, 255];
      }
    }
  }
  const cell: [number, number] = [cw, ch];
  return { art, heights, cell };
};

test("each art texel's surface is the first solid its view ray meets down its cell, fringes the nearest's", () => {
  const { art, heights, cell } = atlas();
  const out = paintSurface(art, heights, cell, 2, 3, 0.75);
  // Recorded from the step-a-px-at-a-time march before it skipped the open heights between solids.
  expect(createHash("sha256").update(out.data).digest("hex")).toBe("0b89ab41387b07b1bf514ac2e5d66b1f71260625609d911f3ef1a0ab83c595c2");
});

test("transparent and opaque texels with no height hit keep their original surface encoding", () => {
  const art = image(7, 9), heights = image(7, 9);
  expect(paintSurface(art, heights, [4, 5], 1, 0, 1).data.every(value => value === 0)).toBe(true);
  for (let k = 3; k < art.data.length; k += 4) art.data[k] = 255;
  const out = paintSurface(art, heights, [4, 5], 1, 0, 1);
  for (let k = 0; k < out.data.length; k += 4) expect(Array.from(out.data.subarray(k, k + 4))).toEqual([0, 0, 0, 255]);
});

test("the first pixel is a visited seed and fringes stop after four rounds and at cell boundaries", () => {
  const art = image(24, 8), heights = image(24, 8);
  for (let k = 3; k < art.data.length; k += 4) art.data[k] = 255;
  for (const x of [0, 11]) { heights.data[4 * x + 2] = 9; heights.data[4 * x + 3] = 255; }
  const out = paintSurface(art, heights, [12, 8], 1, 0, 1);
  expect(out.data[3]).toBe(9);
  expect(out.data[4 * 7 + 3]).toBe(9);
  expect(out.data[4 * (5 * 24) + 3]).toBe(255);
  expect(out.data[4 * 12 + 3]).toBe(255);
});

test("visited bookkeeping uses at most one byte per atlas pixel", () => {
  const width = 37, height = 41, pixels = width * height;
  const art = image(width, height), heights = image(width, height);
  let markerBytes = 0;
  const track = <T extends Uint8ArrayConstructor | Int32ArrayConstructor>(constructor: T): T => new Proxy(constructor, {
    construct(target, args) {
      const result = Reflect.construct(target, args);
      if (result.length === pixels) markerBytes += result.byteLength;
      return result;
    },
  });
  const originalUint8Array = globalThis.Uint8Array, originalInt32Array = globalThis.Int32Array;
  globalThis.Uint8Array = track(originalUint8Array);
  globalThis.Int32Array = track(originalInt32Array);
  try {
    const out = paintSurface(art, heights, [8, 9], 2, 3, 0.75);
    expect(out.data.every(value => value === 0)).toBe(true);
    expect(markerBytes).toBeLessThanOrEqual(pixels);
  } finally {
    globalThis.Uint8Array = originalUint8Array;
    globalThis.Int32Array = originalInt32Array;
  }
});
