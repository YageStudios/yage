/**
 * Textured quads drawn into a chunk layer's depth buffer at a foot position of their own: what an
 * entity holds or wears (a rifle, a hand) draws over its entity and under anyone standing in front
 * of it, as the entities themselves do (layer.ts: lower on screen is nearer). Depth-tested, not
 * written, blended: refilled every frame with `begin`, `quad`…, `end`; quads draw in that order.
 *
 * Add it to the camera's container after the scene's layers, with no filter or render target
 * between them, so the layers' depth is still there when it draws.
 */
import * as PIXI from "pixi.js";

const GL_FLOAT = 5126;

const vertex = `
precision highp float;
attribute vec2 aPos;
attribute vec2 aUv;
attribute vec4 aColor;
attribute vec2 aFoot;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
varying vec2 vUv;
varying vec4 vColor;

void main() {
  mat3 m = projectionMatrix * translationMatrix;
  vec3 clip = m * vec3(aPos, 1.0);
  vec3 clipFoot = m * vec3(aFoot, 1.0);
  // The layers' depth (layer.ts): lower on screen is nearer.
  gl_Position = vec4(clip.xy, clamp(clipFoot.y * 0.5, -0.999, 0.999), 1.0);
  vUv = aUv;
  vColor = aColor;
}
`;

const fragment = `
precision mediump float;
varying vec2 vUv;
varying vec4 vColor;
uniform sampler2D uSampler;

void main() {
  vec4 texel = texture2D(uSampler, vUv);
  if (texel.a < 0.03) discard;
  gl_FragColor = vec4(texel.rgb * vColor.rgb, texel.a) * vColor.a;
}
`;

/** How far (world units) in front of its foot a quad is: it draws over the entity standing there (smaller is lost to the depth buffer's rounding). */
export const DEPTH_NUDGE = 1.5;

/** A part of a texture, 0-1 of each side. */
export type QuadFrame = { x: number; y: number; width: number; height: number };
const FULL: QuadFrame = { x: 0, y: 0, width: 1, height: 1 };

export class DepthQuads extends PIXI.Mesh<PIXI.Shader> {
  /** Quads this frame. */
  count = 0;
  private capacity = 0;
  private originX = 0;
  private originY = 0;
  private pos = new Float32Array(0);
  private uv = new Float32Array(0);
  private color = new Float32Array(0);
  private foot = new Float32Array(0);
  private readonly buffers: Record<"pos" | "uv" | "color" | "foot" | "index", PIXI.Buffer>;

  constructor(texture: PIXI.Texture) {
    const buffers = {
      pos: new PIXI.Buffer(new Float32Array(0), false),
      uv: new PIXI.Buffer(new Float32Array(0), false),
      color: new PIXI.Buffer(new Float32Array(0), false),
      foot: new PIXI.Buffer(new Float32Array(0), false),
      index: new PIXI.Buffer(new Uint16Array(0), false, true),
    };
    const geometry = new PIXI.Geometry()
      .addAttribute("aPos", buffers.pos, 2, false, GL_FLOAT as PIXI.TYPES)
      .addAttribute("aUv", buffers.uv, 2, false, GL_FLOAT as PIXI.TYPES)
      .addAttribute("aColor", buffers.color, 4, false, GL_FLOAT as PIXI.TYPES)
      .addAttribute("aFoot", buffers.foot, 2, false, GL_FLOAT as PIXI.TYPES)
      .addIndex(buffers.index);
    const state = PIXI.State.for2d();
    state.depthTest = true;
    state.depthMask = false;
    state.blend = true;
    super(geometry, PIXI.Shader.from(vertex, fragment, { uSampler: texture }), state);
    this.buffers = buffers;
  }

  /** Keep this draw's upload coordinates close to zero; quad inputs and corner outputs stay world-space. */
  begin(originX = 0, originY = 0) {
    this.count = 0;
    this.originX = originX;
    this.originY = originY;
    this.position.set(originX, originY);
  }

  /**
   * The texture drawn `width` × `height` (world units; a negative height flips it), its anchor
   * (0-1 of each side) at (x, y), turned by `rotation`, tinted, in front of the entity whose feet
   * are at (footX, footY). `frame` picks part of the texture (0-1 of each side): one cell of an atlas.
   */
  quad(x: number, y: number, width: number, height: number, anchorX: number, anchorY: number, rotation: number, tint: number, alpha: number, footX: number, footY: number, frame = FULL) {
    if (this.count === this.capacity) this.grow();
    const q = this.count++;
    // The camera transforms after Float32 packing, too late to recover small global details.
    x -= this.originX; y -= this.originY;
    footX -= this.originX; footY -= this.originY;
    const cos = Math.cos(rotation), sin = Math.sin(rotation);
    const r = ((tint >> 16) & 255) / 255, g = ((tint >> 8) & 255) / 255, b = (tint & 255) / 255;
    for (let c = 0; c < 4; c++) {
      const u = c === 1 || c === 2 ? 1 : 0;
      const v = c >= 2 ? 1 : 0;
      const lx = (u - anchorX) * width, ly = (v - anchorY) * height;
      const i = q * 4 + c;
      this.pos[i * 2] = x + lx * cos - ly * sin;
      this.pos[i * 2 + 1] = y + lx * sin + ly * cos;
      this.uv[i * 2] = frame.x + u * frame.width;
      this.uv[i * 2 + 1] = frame.y + v * frame.height;
      this.color.set([r, g, b, alpha], i * 4);
      this.foot[i * 2] = footX;
      this.foot[i * 2 + 1] = footY + DEPTH_NUDGE;
    }
  }

  end() {
    this.buffers.pos.update(this.pos);
    this.buffers.uv.update(this.uv);
    this.buffers.color.update(this.color);
    this.buffers.foot.update(this.foot);
    this.size = this.count * 6;
    this.visible = this.count > 0;
  }

  /** Where quad `q`'s corner `c` is (world), as last drawn. */
  corner(q: number, c: number) {
    return { x: this.originX + this.pos[(q * 4 + c) * 2], y: this.originY + this.pos[(q * 4 + c) * 2 + 1] };
  }

  private grow() {
    this.capacity = Math.max(16, this.capacity * 2);
    const grown = (old: Float32Array, per: number) => {
      const next = new Float32Array(this.capacity * 4 * per);
      next.set(old);
      return next;
    };
    this.pos = grown(this.pos, 2);
    this.uv = grown(this.uv, 2);
    this.color = grown(this.color, 4);
    this.foot = grown(this.foot, 2);
    const index = new Uint16Array(this.capacity * 6);
    for (let q = 0; q < this.capacity; q++) index.set([q * 4, q * 4 + 1, q * 4 + 2, q * 4, q * 4 + 2, q * 4 + 3], q * 6);
    this.buffers.index.update(index);
  }
}
