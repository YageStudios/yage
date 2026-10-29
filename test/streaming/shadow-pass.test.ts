import { describe, expect, it, vi } from "vitest";
import { heightColor, solidColor, WALL_COLOR } from "yage/streaming/shadow-pass";

// Its light is drawn with a Mesh, which the pixi.js mock has none of.
vi.mock("yage/streaming/window-light", () => ({ renderInto: () => {} }));

describe("heightColor", () => {
  it("keeps the height in red and the rise's whole px in green, its 16ths in blue", () => {
    expect(heightColor(144, 200)).toBe((144 << 16) | (200 << 8));
    expect(heightColor(144, 20.25)).toBe((144 << 16) | (20 << 8) | 4);
  });

  it("keeps a rise past 255 in blue's bit 4", () => {
    expect(heightColor(10, 300)).toBe((10 << 16) | (44 << 8) | 16);
  });

  it("clamps the height to a byte and the rise under 512", () => {
    expect(heightColor(400, 1000)).toBe((255 << 16) | (255 << 8) | 31);
    expect(heightColor(-3)).toBe(0);
  });

  it("never draws a wall's colour", () => {
    expect(heightColor(255, 1000) & 0x80).toBe(0);
    expect(WALL_COLOR & 0xffff7f).toBe(0);
  });
});

describe("solidColor", () => {
  it("keeps the top in red and the underside in green, a px each", () => {
    expect(solidColor(30, 26)).toBe((30 << 16) | (26 << 8));
    expect(solidColor(30)).toBe(heightColor(30));
    expect(solidColor(300, -2)).toBe(255 << 16);
  });
});
