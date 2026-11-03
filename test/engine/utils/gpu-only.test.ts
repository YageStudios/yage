import { describe, expect, it, vi } from "vitest";
import * as PIXI from "pixi.js";
import { gpuOnly, gpuReplace, paintedOnUpload } from "../../../engine/utils/gpu-only";

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

describe("gpuReplace", () => {
  const buffer = (fill: number) => new PIXI.BufferResource(new Uint8Array(32).fill(fill), { width: 4, height: 2 });
  const spies = new Map<PIXI.Resource, ReturnType<typeof vi.fn>>();
  const uploaded = <R extends PIXI.Resource>(resource: R) => {
    const upload = vi.fn(() => true);
    spies.set(resource, upload);
    return Object.assign(resource, { upload });
  };

  it("swaps in new pixels and drops them once they are on the GPU, before or after the first upload", async () => {
    const first = uploaded(buffer(1));
    const texture = gpuOnly(new PIXI.Texture(new PIXI.BaseTexture(first)));
    const base = texture.baseTexture;
    // Replaced before it was ever drawn: the old source goes at once, unuploaded.
    const second = uploaded(buffer(2));
    gpuReplace(texture, second);
    expect(spies.get(first)).not.toHaveBeenCalled();
    expect(first.data).toBeNull();
    expect(base.resource).toBe(second);
    expect(base.resource.upload({} as PIXI.Renderer, base, {} as PIXI.GLTexture)).toBe(true);
    await Promise.resolve();
    expect(base.resource).toBeNull();
    expect(second.data).toBeNull();
    // Replaced once on the GPU (no source left): uploaded on the next bind, then dropped too.
    const third = uploaded(buffer(3));
    const release = vi.fn();
    const dirty = base.dirtyId;
    gpuReplace(texture, third, release);
    expect(base.dirtyId).toBeGreaterThan(dirty);
    expect(base.resource.upload({} as PIXI.Renderer, base, {} as PIXI.GLTexture)).toBe(true);
    expect(spies.get(third)).toHaveBeenCalledOnce();
    await Promise.resolve();
    expect(base.resource).toBeNull();
    expect(release).toHaveBeenCalledOnce();
    expect([texture.width, texture.height]).toEqual([4, 2]);
  });
});
