/**
 * The sun's shadows for static instances, one pass over everything they draw (ChunkScene's
 * `castRoot`): the scene is flat, but each instance says how tall it stands, so the pass treats it
 * as 3D. Two buffers, drawn where the camera puts things:
 *
 *  - heights: every instance's `StaticParts.heights`, seen from straight above (a building's
 *    footprint at its height, the water tower on its roof higher still), reaching past the screen's
 *    edge toward the sun, so what stands just off screen still shades what's on it;
 *  - tops: every instance's `StaticParts.tops`, the roofs as the screen shows them (lifted up the
 *    screen by their walls' `rise`), each with its height and rise, and its walls' faces in
 *    `WALL_COLOR`; the rest is ground, at 0;
 *  - casts: upright sprites' own shadows on the ground (ChunkLayerStyle `cast`: a tree's silhouette
 *    laid toward the sun) and instances' `StaticParts.casts`, anything drawn marking shade.
 *
 * Then one quad over the screen: each pixel finds its point on the ground plan (down the screen by
 * its rise) and marches from there toward the sun (north-west; shadows fall toward +x, +y, a unit
 * of height one unit along each) through the heights; if something stands above the ray it is in
 * shade, at the pass's darkness. So towers shade the street and the lower roofs beside them, a
 * parapet the deck inside it, a water tower the roof it stands on, and a tree the ground beside it,
 * each once however many overlap.
 * A wall's face, and a pixel standing below the heights at its own point (a water tower's side), is
 * left as its art draws it.
 *
 * Drawn the way LightPass draws its light, not through a Pixi filter, which would drop a camera
 * sitting in the projection (ProjectedCamera) for what draws after.
 */
import * as PIXI from "pixi.js";
import { renderInto } from "./window-light";

const GL_FLOAT = 5126;
/** Heights and rises are world px, kept in a byte each: heights to 255, rises to 510 in 2s. */
const RISE_STEP = 2;

/** The fill colour a `heights` or `tops` shape is drawn in for something `height` px tall (world px), its roof drawn `rise` px up the screen. */
export const heightColor = (height: number, rise = 0) => (Math.max(0, Math.min(255, Math.round(height))) << 16) | (Math.max(0, Math.min(255, Math.round(rise / RISE_STEP))) << 8);

/** The fill colour a `tops` shape is drawn in for a wall's face: the sun leaves it as its art draws it. */
export const WALL_COLOR = 0x0000ff;

const vertex = `
precision highp float;
attribute vec2 aVertexPosition;
void main() {
  gl_Position = vec4(aVertexPosition, 0.0, 1.0);
}
`;

const STEPS = 40;
const fragment = `
precision highp float;
uniform sampler2D uHeights;
uniform sampler2D uTops;
uniform sampler2D uCasts;
uniform vec2 uView;
uniform float uRes;
uniform vec4 uFrame;
uniform float uScale;
uniform float uReach;
uniform float uDarkness;
float heightAt(vec2 p) {
  return texture2D(uHeights, (p - uFrame.xy) / uFrame.zw).r * 255.0;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uView.y * uRes - gl_FragCoord.y) / uRes;
  vec4 top = texture2D(uTops, p / uView);
  float h = top.r * 255.0;
  vec2 ground = p + vec2(0.0, top.g * ${255 * RISE_STEP}.0 * uScale);
  float shade = 0.0;
  float below = heightAt(ground);
  // Sprites' shadows lie on open ground only, never up a wall or over a roof.
  if (top.b < 0.5 && h < 0.5 && below < 1.5) shade = texture2D(uCasts, p / uView).a;
  if (top.b < 0.5 && below <= h + 1.5 && shade < 1.0) {
    float reach = uReach - h;
    for (int i = 1; i <= ${STEPS}; i++) {
      float f = float(i) / ${STEPS}.0;
      float t = f * f * reach;
      if (heightAt(ground - vec2(t) * uScale) > h + t + 0.5) {
        shade = 1.0;
        break;
      }
    }
  }
  gl_FragColor = vec4(0.0, 0.0, 0.0, shade * uDarkness);
}
`;

let program: PIXI.Program | null = null;

const bufferOf = () => {
  const buffer = PIXI.RenderTexture.create({ width: 1, height: 1, resolution: 1 });
  buffer.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
  return buffer;
};

export class ShadowPass extends PIXI.Container {
  /** How dark a shadow lies, 0–1. */
  darkness = 0.2;
  /** The tallest anything stands (world px, to 255): how far toward the sun a pixel looks. */
  reach = 160;
  /** Instances' heights, from above (StaticSet adds them). */
  readonly heights = new PIXI.Container();
  /** Instances' tops, as the screen shows them (StaticSet adds them). */
  readonly tops = new PIXI.Container();
  /** Upright sprites' shadows on the ground, as the screen shows them (ChunkScene adds them, ChunkLayerStyle `cast`). */
  readonly casts = new PIXI.Container();
  private readonly heightBuffer = bufferOf();
  private readonly topBuffer = bufferOf();
  private readonly castBuffer = bufferOf();
  private readonly view = new Float32Array([1, 1]);
  private readonly frame = new Float32Array([0, 0, 1, 1]);
  private readonly quad: PIXI.Mesh<PIXI.Shader>;

  constructor() {
    super();
    this.eventMode = "none";
    this.addChild(this.heights, this.tops, this.casts);
    program ??= PIXI.Program.from(vertex, fragment, "yage-shadow-pass");
    // The whole screen, in clip space.
    const geometry = new PIXI.Geometry().addAttribute("aVertexPosition", [-1, -1, 1, -1, 1, 1, -1, 1], 2, false, GL_FLOAT as PIXI.TYPES).addIndex([0, 1, 2, 0, 2, 3]);
    const shader = new PIXI.Shader(program, { uHeights: this.heightBuffer, uTops: this.topBuffer, uCasts: this.castBuffer, uView: this.view, uRes: 1, uFrame: this.frame, uScale: 1, uReach: this.reach, uDarkness: this.darkness });
    this.quad = new PIXI.Mesh(geometry, shader);
  }

  render(renderer: PIXI.Renderer) {
    const shown = (c: PIXI.DisplayObject) => c.visible;
    if (!this.visible || this.darkness <= 0.002 || !(this.tops.children.some(shown) || this.casts.children.some(shown))) return;
    const { width, height } = renderer.screen;
    // Screen px per world px, where the camera and this pass's parents put the instances.
    const m = renderer.projection.projectionMatrix;
    const t = this.worldTransform;
    const scale = (Math.hypot(m.a, m.b) * Math.hypot(t.a, t.b) * width) / 2;
    // The heights reach past the screen toward the sun, and down it by the tallest rise (a roof at
    // the screen's foot stands on ground below it).
    const toward = Math.ceil(this.reach * scale);
    const below = Math.ceil(255 * RISE_STEP * scale);
    const frame = new PIXI.Rectangle(-toward, -toward, Math.ceil(width) + toward, Math.ceil(height) + toward + below);
    size(this.heightBuffer, frame.width, frame.height);
    size(this.topBuffer, width, height);
    size(this.castBuffer, width, height);
    renderInto(renderer, this.heightBuffer, [0, 0, 0, 0], () => this.heights.render(renderer), frame);
    renderInto(renderer, this.topBuffer, [0, 0, 0, 0], () => this.tops.render(renderer));
    renderInto(renderer, this.castBuffer, [0, 0, 0, 0], () => this.casts.render(renderer));
    this.view[0] = width;
    this.view[1] = height;
    this.frame[0] = frame.x;
    this.frame[1] = frame.y;
    this.frame[2] = frame.width;
    this.frame[3] = frame.height;
    const uniforms = this.quad.shader.uniforms;
    uniforms.uRes = renderer.view.width / width;
    uniforms.uScale = scale;
    uniforms.uReach = Math.min(255, this.reach);
    uniforms.uDarkness = this.darkness;
    this.quad.render(renderer);
    renderer.batch.flush();
  }

  destroy(options?: PIXI.IDestroyOptions | boolean) {
    super.destroy(options);
    this.heightBuffer.destroy(true);
    this.topBuffer.destroy(true);
    this.castBuffer.destroy(true);
    this.quad.destroy();
  }
}

const size = (buffer: PIXI.RenderTexture, width: number, height: number) => {
  if (buffer.width !== Math.ceil(width) || buffer.height !== Math.ceil(height)) buffer.resize(Math.ceil(width), Math.ceil(height));
};
