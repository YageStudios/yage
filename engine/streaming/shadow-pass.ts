/**
 * The sun's shadows for static instances, one pass over everything they draw (ChunkScene's
 * `castRoot`): the scene is flat, but each instance says how tall it stands, so the pass treats it
 * as 3D. Two buffers, drawn where the camera puts things:
 *
 *  - heights: every instance's `StaticParts.heights` and every props layer's (ChunkLayerStyle
 *    `heights`), seen from straight above (a building's footprint at its height, the water tower on
 *    its roof higher still, a bench's seat), reaching past the screen's edge toward the sun, so what
 *    stands just off screen still shades what's on it. Each shape keeps its top and its underside
 *    (`solidColor`): a lamp's arm or an awning stands clear of the ground, and the sun gets under it;
 *  - tops: every instance's `StaticParts.tops`, the roofs as the screen shows them (lifted up the
 *    screen by their walls' `rise`), each with its height and rise, and its walls' faces in
 *    `WALL_COLOR`; the rest is ground, at 0;
 *  - casts: upright sprites' own shadows on the ground (ChunkLayerStyle `cast`: a tree's silhouette
 *    laid toward the sun), anything drawn marking shade.
 *
 * Then one quad over the screen: each pixel finds its point on the ground plan (down the screen by
 * its rise) and marches from there toward the sun (north-west; shadows fall toward +x, +y, a unit
 * of height one unit along each) through the heights; if something stands above the ray it is in
 * shade, at the pass's darkness. So towers shade the street and the lower roofs beside them, a
 * parapet the deck inside it, a water tower the roof it stands on, and a tree the ground beside it,
 * each once however many overlap.
 * A wall's face, and a pixel the art draws a body over (a water tower's side, a bench's back: found
 * looking down the screen through the heights, `stand` px tall a px of rise), is left as its art
 * draws it; the ground showing under something held up isn't, so its shade meets what holds it.
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

/**
 * The fill colour a `heights` shape is drawn in for a solid from `base` up to `top` (world px, to
 * 255): `base` 0 stands on the ground, above it the sun passes under (a lamp's arm, a table top).
 */
export const solidColor = (top: number, base = 0) => (Math.max(0, Math.min(255, Math.round(top))) << 16) | (Math.max(0, Math.min(255, Math.round(base))) << 8);

/** The fill colour a `tops` shape is drawn in for a wall's face: the sun leaves it as its art draws it. */
export const WALL_COLOR = 0x0000ff;

const vertex = `
precision highp float;
attribute vec2 aVertexPosition;
void main() {
  gl_Position = vec4(aVertexPosition, 0.0, 1.0);
}
`;

const STEPS = 32;
/** How far (world px) the march looks a px (or half one) at a time before stepping out further apart. */
const NEAR = 32;
/** How far (world px) down the screen a pixel looks for a body drawn over it: the tallest thing's rise. */
const COVER = 48;
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
uniform float uStand;
// What stands at plan point p: its top and its underside.
vec2 solidAt(vec2 p) {
  return texture2D(uHeights, (p - uFrame.xy) / uFrame.zw).rg * 255.0;
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uView.y * uRes - gl_FragCoord.y) / uRes;
  vec4 top = texture2D(uTops, p / uView);
  float h = top.r * 255.0;
  vec2 ground = p + vec2(0.0, top.g * ${255 * RISE_STEP}.0 * uScale);
  float shade = 0.0;
  // Whether the art draws a body over our point, seen from the front: something standing at our
  // point from under us up, or a face rising up the screen from its plan just south of us (a world
  // px down the screen for every uStand it stands). Ground showing under a thing held up (a bus's
  // body over its wheels, a bowl over its pedestal, a canopy) isn't covered, and marches like any
  // other, so its shade starts at the edge of what stands it up.
  float tol = h < 0.5 ? 0.5 : 1.5;
  bool covered = false;
  for (int i = 0; i <= ${COVER}; i++) {
    float z = h + float(i) * uStand;
    vec2 solid = solidAt(ground + vec2(0.0, float(i)) * uScale);
    if (solid.x > z + tol && solid.y <= z + tol) {
      covered = true;
      break;
    }
  }
  // Sprites' shadows lie on open ground only, never up a wall or over a roof.
  if (top.b < 0.5 && h < 0.5 && !covered) shade = texture2D(uCasts, p / uView).a;
  if (top.b < 0.5 && !covered && shade < 1.0) {
    // Near, a world px a step (half one zoomed in, where a world px is several on screen): a post
    // or a lamp's lantern is thinner than the far steps, and the steps would show along its edges.
    float step = uScale >= 2.0 ? 0.5 : 1.0;
    for (int i = 1; i <= ${NEAR * 2}; i++) {
      float t = float(i) * step;
      if (t > ${NEAR}.0) break;
      vec2 solid = solidAt(ground - vec2(t) * uScale);
      if (solid.x > h + t + 0.5 && solid.y <= h + t) {
        shade = 1.0;
        break;
      }
    }
    float reach = uReach - h - ${NEAR}.0;
    for (int i = 1; i <= ${STEPS}; i++) {
      if (shade > 0.5 || reach <= 0.0) break;
      float f = float(i) / ${STEPS}.0;
      float t = ${NEAR}.0 + f * f * reach;
      vec2 solid = solidAt(ground - vec2(t) * uScale);
      if (solid.x > h + t + 0.5 && solid.y <= h + t) {
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
  /** World px a thing stands for every px its art rises up the screen. */
  stand = 0.75;
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
    const shader = new PIXI.Shader(program, { uHeights: this.heightBuffer, uTops: this.topBuffer, uCasts: this.castBuffer, uView: this.view, uRes: 1, uFrame: this.frame, uScale: 1, uReach: this.reach, uDarkness: this.darkness, uStand: this.stand });
    this.quad = new PIXI.Mesh(geometry, shader);
  }

  render(renderer: PIXI.Renderer) {
    const shown = (c: PIXI.DisplayObject) => c.visible;
    if (!this.visible || this.darkness <= 0.002 || !(this.heights.children.some(shown) || this.casts.children.some(shown))) return;
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
    uniforms.uStand = this.stand;
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
