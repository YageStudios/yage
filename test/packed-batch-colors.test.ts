import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as PIXI from "pixi.js";
import { beforeAll, expect, test, vi } from "vitest";
import {
  installPackedBatchColors,
  packedTint,
} from "../engine/systems/render/packed-batch-colors";
vi.unmock("pixi.js");

const before = PIXI.BatchRenderer.prototype.packInterleavedGeometry;
const batch = Object.create(PIXI.BatchRenderer.prototype);
batch.vertexSize = 6;
const renderer = { plugins: { batch } } as PIXI.Renderer;
let restore: () => void;
beforeAll(() => {
  class Canvas {
    width = 0;
    height = 0;
    getContext = (kind: string) =>
      kind === "2d" ? { fillStyle: "", fillRect() {} } : null;
  }
  vi.stubGlobal("HTMLCanvasElement", Canvas);
  vi.stubGlobal("document", { createElement: () => new Canvas() });
  restore = installPackedBatchColors(renderer);
});
function element(tint: unknown, alpha = 1, mode = 1) {
  return {
    _tintRGB: tint,
    worldAlpha: alpha,
    _texture: { baseTexture: { _batchLocation: 3, alphaMode: mode } },
    uvs: new Float32Array([0, 0.25, 1, 0, 0.5, 1]),
    vertexData: new Float32Array([1, 2, -30, 15, 60, -100]),
    indices: new Uint16Array([0, 1, 2, 2, 1, 0]),
  } as Parameters<typeof before>[0];
}
function output(fn: typeof before, e: Parameters<typeof before>[0]) {
  const attributes = new PIXI.ViewableBuffer(
      (24 + (e.vertexData.length / 2) * 6) * 4
    ),
    indices = new Uint16Array(12 + e.indices.length);
  attributes.uint32View.fill(0xcafef00d);
  indices.fill(0xbaad);
  fn.call(batch, e, attributes, indices, 12, 4);
  return {
    attributes: Array.from(attributes.uint32View),
    indices: Array.from(indices),
  };
}
test("all256 channel values, alpha modes and normal alpha edges pack bit-identically", () => {
  for (let c = 0; c < 256; c++)
    for (const a of [0, 0.0001, 0.1, 0.499, 0.999, 1, 1.2])
      for (const mode of [0, 1, 2]) {
        const e = element(
          (c << 16) | ((255 - c) << 8) | (c * 37) % 256,
          a,
          mode
        );
        expect(output(batch.packInterleavedGeometry, e)).toEqual(
          output(before, e)
        );
      }
});
test("unusual color sources delegate with original output, input mutation and thrown object behavior", () => {
  for (const tint of [
    new Float32Array([0.2, 0.4, 0.8]),
    new Uint8Array([128, 42, 255]),
    [0.4, 0.5, 0.6],
    "red",
    new PIXI.Color("blue"),
    -1,
    0.5,
    0x1000000,
    NaN,
    null,
  ]) {
    expect(packedTint(tint, 0.5, true)).toBeNull();
    const e = element(tint, 0.5);
    let expected, actual, err1, err2;
    try {
      expected = output(before, e);
    } catch (e) {
      err1 = e;
    }
    try {
      actual = output(batch.packInterleavedGeometry, e);
    } catch (e) {
      err2 = e;
    }
    if (err1) expect((err2 as Error).message).toBe((err1 as Error).message);
    else expect(actual).toEqual(expected);
  }
});
test("negative and nonfinite world alpha preserve original packed bits", () => {
  for (const a of [-1, -0.1, NaN, -Infinity, Infinity])
    for (const mode of [0, 1])
      expect(
        output(batch.packInterleavedGeometry, element(0xfedcba, a, mode))
      ).toEqual(output(before, element(0xfedcba, a, mode)));
});
test("missing/custom batch implementation remains untouched; release respects a later owner", () => {
  const unusual = Object.create(PIXI.BatchRenderer.prototype);
  unusual.vertexSize = 7;
  installPackedBatchColors({ plugins: { batch: unusual } } as PIXI.Renderer)();
  expect(unusual.packInterleavedGeometry).toBe(before);
  const own = () => {};
  const custom = {
    plugins: { batch: { packInterleavedGeometry: own } },
  } as unknown as PIXI.Renderer;
  installPackedBatchColors(custom)();
  expect(custom.plugins.batch.packInterleavedGeometry).toBe(own);
  const other = Object.create(PIXI.BatchRenderer.prototype);
  other.vertexSize = 6;
  other.packInterleavedGeometry = own;
  const r = { plugins: { batch: other } } as PIXI.Renderer;
  installPackedBatchColors(r)();
  expect(other.packInterleavedGeometry).toBe(own);
  restore();
  expect(batch.packInterleavedGeometry).toBe(before);
  restore = installPackedBatchColors(renderer);
  batch.packInterleavedGeometry = own;
  restore();
  expect(batch.packInterleavedGeometry).toBe(own);
  batch.packInterleavedGeometry = before;
  restore = installPackedBatchColors(renderer);
});
test("empty batches preserve untouched storage and original fallback exceptions propagate unchanged", () => {
  const e = element(0xffffff);
  e.vertexData = new Float32Array();
  e.uvs = new Float32Array();
  e.indices = new Uint16Array();
  expect(output(batch.packInterleavedGeometry, e)).toEqual(output(before, e));
  const sentinel = Error("original conversion sentinel"),
    spy = vi.spyOn(PIXI.Color.shared, "setValue").mockImplementation(() => {
      throw sentinel;
    });
  try {
    expect(() => output(batch.packInterleavedGeometry, element("red"))).toThrow(
      sentinel
    );
  } finally {
    spy.mockRestore();
  }
});

test("the complete actual ordinary-frame corpus packs identically", () => {
  const fixture = JSON.parse(
    gunzipSync(
      readFileSync(
        new URL(
          "./render/fixtures/packed-batch-actual.json.gz",
          import.meta.url
        )
      )
    ).toString()
  );
  expect(fixture.captureStats).toEqual({
    calls: 7223,
    numericRGB: 7223,
    nonNumericRGB: 0,
    nonfiniteAlpha: 0,
  });
  expect(fixture.overflow).toBe(false);
  const elements: Parameters<typeof before>[0][] = fixture.arguments.map(
    (e: any) => ({
      ...e,
      vertexData: new Float32Array(Uint32Array.from(e.vertexData).buffer),
      uvs: new Float32Array(Uint32Array.from(e.uvs).buffer),
      indices:
        e.types.indices === "Uint32Array"
          ? Uint32Array.from(e.indices)
          : Uint16Array.from(e.indices),
    })
  );
  for (const e of elements)
    expect(output(batch.packInterleavedGeometry, e)).toEqual(output(before, e));
  if (process.env.PACKED_BATCH_BENCH === "1") {
    const rows = elements.map((e) => ({
      e,
      attributes: new PIXI.ViewableBuffer(
        (24 + (e.vertexData.length / 2) * 6) * 4
      ),
      indices: new Uint16Array(12 + e.indices.length),
    }));
    const timings = [];
    for (let block = 0; block < 4; block++)
      for (const name of ["A", "B", "B", "A"]) {
        const fn = name === "A" ? before : batch.packInterleavedGeometry,
          began = performance.now();
        for (let repeat = 0; repeat < 8; repeat++)
          for (const row of rows)
            fn.call(batch, row.e, row.attributes, row.indices, 12, 4);
        timings.push({
          block,
          name,
          ms: performance.now() - began,
          passes: 8,
          batches: rows.length,
        });
      }
    console.log(
      JSON.stringify({
        qualification:
          "Node repeatability control, not native FPS; captured ordinary-frame input",
        timings,
      })
    );
  }
});
