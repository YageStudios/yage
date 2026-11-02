import { describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import { gpuOnly, paintedOnUpload } from "../../../engine/utils/gpu-only";

// The real textures (setup.ts mocks pixi.js for the engine's display code).
vi.unmock("pixi.js");

describe("paintedOnUpload", () => {
  it("paints only on the first upload, and gpuOnly drops what it painted once it is on the GPU", async () => {
    const upload = vi.fn(() => true);
    const release = vi.fn();
    const make = vi.fn(() => ({ resource: Object.assign(new PIXI.BufferResource(new Uint8Array(32), { width: 4, height: 2 }), { upload }), release }));
    const texture = gpuOnly(paintedOnUpload(4, 2, make));
    expect(make).not.toHaveBeenCalled();
    expect([texture.width, texture.height]).toEqual([4, 2]);
    const base = texture.baseTexture;
    expect(base.resource.upload({} as PIXI.Renderer, base, {} as PIXI.GLTexture)).toBe(true);
    expect(make).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(base.resource).toBeNull();
    expect(release).toHaveBeenCalledOnce();
  });
});
