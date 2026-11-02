import * as PIXI from "pixi.js";

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

/**
 * A texture `width` × `height` whose source is made only when the renderer first uploads it: `make`
 * paints it then (and nothing is held before). Wrap it in gpuOnly and the source goes again once it is
 * on the GPU, so a texture that is never drawn never costs its pixels. `release` runs as gpuOnly drops it.
 */
export const paintedOnUpload = (
  width: number,
  height: number,
  make: () => Painted,
  options?: PIXI.IBaseTextureOptions
): PIXI.Texture => new PIXI.Texture(new PIXI.BaseTexture(paintOnUpload(width, height, make), options));

type Painted = { resource: PIXI.Resource; release?: () => void };

/** The resource behind paintedOnUpload: `make`'s resource does each upload, made on the first. */
const paintOnUpload = (width: number, height: number, make: () => Painted): PIXI.Resource => new (paintOnUploadClass ??= definePaintOnUpload())(width, height, make);

// Defined on first use, not at import: test setups that stub pixi.js need not provide Resource.
let paintOnUploadClass: ReturnType<typeof definePaintOnUpload> | undefined;
const definePaintOnUpload = () =>
  class PaintOnUpload extends PIXI.Resource {
    private made: Painted | null = null;
    constructor(width: number, height: number, private readonly make: () => Painted) {
      super(width, height);
    }
    upload(renderer: PIXI.Renderer, baseTexture: PIXI.BaseTexture, glTexture: PIXI.GLTexture): boolean {
      return (this.made ??= this.make()).resource.upload(renderer, baseTexture, glTexture);
    }
    dispose() {
      this.made?.resource.destroy();
      this.made?.release?.();
      this.made = null;
    }
  };
