import { describe, expect, it, vi } from "vitest";
import { heightColor, WALL_COLOR } from "yage/streaming/shadow-pass";

// Its light is drawn with a Mesh, which the pixi.js mock has none of.
vi.mock("yage/streaming/window-light", () => ({ renderInto: () => {} }));

describe("heightColor", () => {
  it("keeps the height in red and the rise in green, in 2s", () => {
    expect(heightColor(144, 200)).toBe((144 << 16) | (100 << 8));
  });

  it("clamps to a byte each", () => {
    expect(heightColor(400, 1000)).toBe((255 << 16) | (255 << 8));
    expect(heightColor(-3)).toBe(0);
  });

  it("never draws a wall's colour", () => {
    expect(heightColor(255, 510) & 0xff).toBe(0);
    expect(WALL_COLOR & 0xffff00).toBe(0);
  });
});
