import * as PIXI from "pixi.js";

/**
 * For a Graphics drawn again every frame (many shapes): the per-shape colour work Pixi does through
 * Color (normalize, clamp, refresh, twice per shape when batching) is done here straight from a
 * number colour, and untextured shapes skip per-vertex UVs. Same values: a byte through /255 and
 * *255 comes back exactly, so Pixi's round trip changes nothing. Anything else goes to Pixi.
 */
const premultiplied = (rgb: number, alpha: number) => {
  const bgr = ((rgb & 0xff) << 16) + (rgb & 0xff00) + ((rgb >> 16) & 0xff);
  if (alpha === 1) return (255 << 24) + bgr;
  if (alpha === 0) return 0;
  const r = (((bgr >> 16) & 0xff) * alpha + 0.5) | 0, g = (((bgr >> 8) & 0xff) * alpha + 0.5) | 0, b = ((bgr & 0xff) * alpha + 0.5) | 0;
  return ((alpha * 255) << 24) + (r << 16) + (g << 8) + b;
};

const isRgb = (c: unknown): c is number => typeof c === "number" && c >= 0 && c <= 0xffffff;

export class LeanGeometry extends PIXI.GraphicsGeometry {
  protected override addColors(colors: number[], color: number, alpha: number, size: number, offset = 0) {
    if (!isRgb(color)) return super.addColors(colors, color, alpha, size, offset);
    const value = premultiplied(color, alpha);
    colors.length = Math.max(colors.length, offset + size);
    for (let i = 0; i < size; i++) colors[offset + i] = value;
  }

  /** Untextured shapes (the white texture, no matrix) sample one white texel wherever they look: no per-vertex UVs to work out. */
  protected override addUvs(verts: number[], uvs: number[], texture: PIXI.Texture, start: number, size: number, matrix: PIXI.Matrix | null = null) {
    if (texture !== PIXI.Texture.WHITE || matrix) return super.addUvs(verts, uvs, texture, start, size, matrix ?? undefined);
    for (let i = 0; i < size; i++) uvs.push(0, 0);
  }
}

/** Graphics.normalizeColor (private in Pixi's types): a number colour is kept as it is, its alpha 1 unless given. */
function normalizeColor(this: PIXI.Graphics, options: { color?: PIXI.ColorSource; alpha?: number }) {
  const color = options.color ?? 0;
  if (isRgb(color)) {
    options.color = color;
    options.alpha ??= 1;
    return;
  }
  const temp = PIXI.Color.shared.setValue(color);
  options.color = temp.toNumber();
  options.alpha ??= temp.alpha;
}

/** A Graphics redrawn every frame: LeanGeometry, and the colour normalize above. */
export class LeanGraphics extends PIXI.Graphics {
  constructor(geometry: PIXI.GraphicsGeometry = new LeanGeometry()) {
    super(geometry);
  }
}
Object.defineProperty(LeanGraphics.prototype, "normalizeColor", { value: normalizeColor, writable: true, configurable: true });
