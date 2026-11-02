import type * as PIXI from "pixi.js";

/**
 * A texture painted once and never changed: its source (a canvas, a buffer) is dropped as soon as it
 * is on the GPU, and `release` (shrink the canvas to nothing) runs then. Without a resource the
 * renderer's texture GC leaves it resident (it unloads only what it could upload again), and nothing
 * re-uploads it unless it is marked dirty. A lost WebGL context leaves it blank.
 */
export const gpuOnly = <T extends PIXI.Texture>(texture: T, release?: () => void): T => {
  const base = texture.baseTexture;
  const resource = base.resource;
  if (!resource) return texture;
  const upload = resource.upload.bind(resource);
  resource.upload = (renderer, baseTexture, glTexture) => {
    const done = upload(renderer, baseTexture, glTexture);
    // After the texture system has finished with this bind.
    queueMicrotask(() => {
      if (base.resource !== resource) return;
      resource.unbind(base);
      base.resource = null as never;
      resource.destroy();
      release?.();
    });
    return done;
  };
  return texture;
};

/** A canvas's pixels gone: what gpuOnly passes as `release` for a canvas source. */
export const dropCanvas = (canvas: HTMLCanvasElement | OffscreenCanvas) => () => {
  canvas.width = canvas.height = 0;
};
