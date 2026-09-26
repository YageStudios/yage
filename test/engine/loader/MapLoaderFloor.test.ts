import { afterEach, describe, expect, test, vi } from "vitest";
import MapLoader from "yage/loader/MapLoader";

// generateFloor renders into a canvas; a recording 2d-context stub lets us
// capture every random draw (gradient centers, stamp placements) without a
// real canvas. Object.create skips the DOM-dependent field initializers.
type GradientRecord = { cx: number; cy: number; inner: number; outer: number };
type StampRecord = { x: number; y: number; width: number };

const makeRecordableLoader = () => {
  const gradients: GradientRecord[] = [];
  const stamps: StampRecord[] = [];
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    scale() {},
    rotate() {},
    beginPath() {},
    arc() {},
    fill() {},
    set fillStyle(_value: string) {},
    set strokeStyle(_value: string) {},
    set globalAlpha(_value: number) {},
    createRadialGradient(cx: number, cy: number, inner: number, _x1: number, _y1: number, outer: number) {
      gradients.push({ cx, cy, inner, outer });
      return { addColorStop() {} };
    },
    drawImage(_image: unknown, x: number, y: number, width: number) {
      stamps.push({ x, y, width });
    },
  };
  const loader = Object.create(MapLoader.prototype) as MapLoader;
  (loader as unknown as { canvas: unknown }).canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => "data:image/png;base64,",
  };
  return { loader, gradients, stamps };
};

const STAMP = { src: "" } as unknown as HTMLImageElement;

describe("floor generation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("generateFloor is deterministic for a given seed", () => {
    vi.stubGlobal("Image", class {
      src = "";
    });
    const first = makeRecordableLoader();
    const second = makeRecordableLoader();
    const config = { stamp: STAMP, seed: 1337, density: 1, stampColor: "#aabbcc" };

    first.loader.generateFloor({ ...config });
    second.loader.generateFloor({ ...config });

    expect(second.gradients).toEqual(first.gradients);
    expect(second.stamps).toEqual(first.stamps);
  });
});
