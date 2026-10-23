/**
 * Draws streamed chunks in one Pixi viewport.
 *
 * Each chunk's entities are one instanced, depth-tested mesh positioned at the chunk's origin.
 * Depth comes from each entity's on-screen foot position, so entities from neighbouring chunks
 * overlap correctly with no cross-chunk sorting, and an entity that has strayed past its border
 * (before its hand-off lands) still draws in the right order. Ground layers draw first and don't
 * touch the depth buffer.
 */
import * as PIXI from "pixi.js";
import { chunkKey } from "./coord";
import { SnapshotPair } from "./interp";
import { POSITION_SCALE, type Snapshot } from "./protocol";

const GL_FLOAT = 5126;
const GL_SHORT = 5122;
const GL_UNSIGNED_BYTE = 5121;
export const MAX_PALETTE = 32;

const vertex = `
precision highp float;
attribute vec2 aCorner;
attribute float aPrevX;
attribute float aPrevY;
attribute float aCurX;
attribute float aCurY;
attribute float aSprite;
attribute float aTint;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform float uAlpha;
uniform float uPositionScale;
uniform vec2 uSize;
uniform float uMinPixels;
uniform vec2 uGrid;
uniform vec3 uPalette[${MAX_PALETTE}];
varying vec2 vUv;
varying vec3 vColor;

void main() {
  if (aTint > 254.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vColor = vec3(0.0);
    return;
  }
  vec2 foot = mix(vec2(aPrevX, aPrevY), vec2(aCurX, aCurY), uAlpha) / uPositionScale;
  float pixelsPerUnit = length(vec2(translationMatrix[0][0], translationMatrix[0][1]));
  float grow = max(1.0, uMinPixels / max(uSize.y * pixelsPerUnit, 0.0001));
  mat3 m = projectionMatrix * translationMatrix;
  vec3 clip = m * vec3(foot + aCorner * uSize * grow, 1.0);
  vec3 clipFoot = m * vec3(foot, 1.0);
  // Lower on screen is nearer, in every chunk alike.
  gl_Position = vec4(clip.xy, clamp(clipFoot.y * 0.5, -0.999, 0.999), 1.0);
  vec2 cell = vec2(mod(aSprite, uGrid.x), floor(aSprite / uGrid.x));
  vUv = (cell + vec2(aCorner.x + 0.5, aCorner.y + 1.0)) / uGrid;
  vColor = uPalette[int(aTint)];
}
`;

const fragment = `
precision mediump float;
varying vec2 vUv;
varying vec3 vColor;
uniform sampler2D uAtlas;

void main() {
  vec4 texel = texture2D(uAtlas, vUv);
  if (texel.a < 0.5) discard;
  gl_FragColor = vec4(texel.rgb * vColor, 1.0);
}
`;

export type ChunkLayerStyle = {
  /** Sprite atlas: a grid of equally sized cells, read with nearest filtering. */
  atlas: PIXI.Texture;
  /** Atlas columns and rows. */
  grid: [number, number];
  /** Sprite size in world units; sprites are anchored at the bottom centre (the feet). */
  size: [number, number];
  /** RGB colours (0xRRGGBB) multiplied into the sprite, indexed by snapshot tint. */
  palette: number[];
  /** Sprites never draw smaller than this many screen pixels tall, so far zooms show dots. */
  minPixels?: number;
};

const paletteArray = (palette: number[]) => {
  const values = new Float32Array(MAX_PALETTE * 3);
  palette.slice(0, MAX_PALETTE).forEach((color, i) => {
    values[i * 3] = ((color >> 16) & 255) / 255;
    values[i * 3 + 1] = ((color >> 8) & 255) / 255;
    values[i * 3 + 2] = (color & 255) / 255;
  });
  return values;
};

/** One chunk's entities as a single instanced draw. */
export class ChunkLayer extends PIXI.Mesh<PIXI.Shader> {
  readonly pair: SnapshotPair;
  private readonly prevX: PIXI.Buffer;
  private readonly prevY: PIXI.Buffer;
  private readonly curX: PIXI.Buffer;
  private readonly curY: PIXI.Buffer;
  private readonly sprite: PIXI.Buffer;
  private readonly tintBuffer: PIXI.Buffer;
  private extent: number;

  constructor(shader: PIXI.Shader, extent: number, expectedInterval: number) {
    const corners = new PIXI.Buffer(new Float32Array([-0.5, -1, 0.5, -1, 0.5, 0, -0.5, 0]), true);
    const empty16 = () => new PIXI.Buffer(new Int16Array(1), false);
    const empty8 = () => new PIXI.Buffer(new Uint8Array(1), false);
    const prevX = empty16();
    const prevY = empty16();
    const curX = empty16();
    const curY = empty16();
    const sprite = empty8();
    const tint = empty8();
    const geometry = new PIXI.Geometry()
      .addAttribute("aCorner", corners, 2, false, GL_FLOAT as PIXI.TYPES)
      .addAttribute("aPrevX", prevX, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aPrevY", prevY, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aCurX", curX, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aCurY", curY, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aSprite", sprite, 1, false, GL_UNSIGNED_BYTE as PIXI.TYPES, 0, 0, true)
      .addAttribute("aTint", tint, 1, false, GL_UNSIGNED_BYTE as PIXI.TYPES, 0, 0, true)
      .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    geometry.instanceCount = 0;
    const state = PIXI.State.for2d();
    state.depthTest = true;
    state.depthMask = true;
    state.blend = false;
    super(geometry, shader, state);
    this.prevX = prevX;
    this.prevY = prevY;
    this.curX = curX;
    this.curY = curY;
    this.sprite = sprite;
    this.tintBuffer = tint;
    this.extent = extent;
    this.pair = new SnapshotPair(expectedInterval);
    this.eventMode = "none";
    this.visible = false;
  }

  push(snapshot: Snapshot, now: number) {
    this.pair.push(snapshot, now);
    const count = snapshot.count;
    this.prevX.update(this.pair.prevX.subarray(0, count));
    this.prevY.update(this.pair.prevY.subarray(0, count));
    this.curX.update(snapshot.x);
    this.curY.update(snapshot.y);
    this.sprite.update(snapshot.sprite);
    this.tintBuffer.update(snapshot.tint);
    this.geometry.instanceCount = count;
    this.visible = count > 0;
  }

  get count() {
    return this.geometry.instanceCount;
  }

  // The chunk square plus its overlap margin, instead of the single template quad.
  _calculateBounds() {
    this._bounds.addFrame(this.transform, -this.extent * 0.1, -this.extent * 0.1, this.extent * 1.1, this.extent * 1.1);
  }

  containsPoint() {
    return false;
  }
}

export type ChunkSceneOptions = {
  chunkSize: number;
  style: ChunkLayerStyle;
  /** Expected milliseconds between snapshots, used until real arrivals are measured. */
  snapshotInterval?: number;
};

type ChunkView = {
  cx: number;
  cy: number;
  ground: PIXI.Container;
  layer: ChunkLayer | null;
};

/**
 * Owns the per-chunk display objects. Add `root` to the game's viewport; feed snapshots with
 * `push` and call `update` once per frame before the viewport renders.
 */
export class ChunkScene {
  readonly root = new PIXI.Container();
  readonly groundRoot = new PIXI.Container();
  readonly entityRoot = new PIXI.Container();
  readonly views = new Map<number, ChunkView>();
  private readonly shader: PIXI.Shader;
  private readonly options: ChunkSceneOptions;

  constructor(options: ChunkSceneOptions) {
    this.options = options;
    const { style } = options;
    style.atlas.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
    style.atlas.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    this.shader = PIXI.Shader.from(vertex, fragment, {
      uAtlas: style.atlas,
      uAlpha: 1,
      uPositionScale: POSITION_SCALE,
      uSize: new Float32Array(style.size),
      uMinPixels: style.minPixels ?? 2,
      uGrid: new Float32Array(style.grid),
      uPalette: paletteArray(style.palette),
    });
    this.root.addChild(this.groundRoot, this.entityRoot);
  }

  setPalette(palette: number[]) {
    this.shader.uniforms.uPalette = paletteArray(palette);
  }

  /** The chunk's view, created on first use and positioned at the chunk's origin. */
  view(cx: number, cy: number): ChunkView {
    const key = chunkKey(cx, cy);
    let view = this.views.get(key);
    if (!view) {
      const ground = new PIXI.Container();
      ground.position.set(cx * this.options.chunkSize, cy * this.options.chunkSize);
      this.groundRoot.addChild(ground);
      view = { cx, cy, ground, layer: null };
      this.views.set(key, view);
    }
    return view;
  }

  push(snapshot: Snapshot, now = performance.now()) {
    const view = this.view(snapshot.cx, snapshot.cy);
    if (!view.layer) {
      view.layer = new ChunkLayer(this.shader, this.options.chunkSize, this.options.snapshotInterval ?? 50);
      view.layer.position.set(snapshot.cx * this.options.chunkSize, snapshot.cy * this.options.chunkSize);
      this.entityRoot.addChild(view.layer);
    }
    view.layer.push(snapshot, now);
  }

  /** Drops a chunk's entity layer (e.g. when it stops being hot), keeping its ground. */
  dropEntities(cx: number, cy: number) {
    const view = this.views.get(chunkKey(cx, cy));
    if (!view?.layer) return;
    view.layer.destroy();
    view.layer = null;
  }

  remove(cx: number, cy: number) {
    const key = chunkKey(cx, cy);
    const view = this.views.get(key);
    if (!view) return;
    view.layer?.destroy();
    view.ground.destroy({ children: true });
    this.views.delete(key);
  }

  /**
   * Culls chunks outside `view` (world units, expanded by one chunk for strays) and sets each
   * layer's interpolation point.
   */
  update(view: { minX: number; minY: number; maxX: number; maxY: number }, now = performance.now()) {
    const size = this.options.chunkSize;
    let drawn = 0;
    for (const chunk of this.views.values()) {
      const x = chunk.cx * size;
      const y = chunk.cy * size;
      const inView = x + size * 1.1 >= view.minX && x - size * 0.1 <= view.maxX && y + size * 1.1 >= view.minY && y - size * 0.1 <= view.maxY;
      chunk.ground.visible = inView;
      if (chunk.layer) {
        chunk.layer.visible = inView && chunk.layer.count > 0;
        if (chunk.layer.visible) drawn += chunk.layer.count;
      }
    }
    // One alpha for all layers keeps neighbouring chunks in step; each uses its own arrival time.
    let alpha = 1;
    for (const chunk of this.views.values()) {
      if (chunk.layer?.visible) {
        alpha = chunk.layer.pair.alpha(now);
        break;
      }
    }
    this.shader.uniforms.uAlpha = alpha;
    return drawn;
  }

  destroy() {
    this.root.destroy({ children: true });
    this.views.clear();
  }
}
