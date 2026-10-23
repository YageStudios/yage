/**
 * Draws streamed chunks in one Pixi viewport.
 *
 * Each chunk's entities are one instanced, depth-tested mesh positioned at the chunk's origin.
 * Depth comes from each entity's on-screen foot position, so entities from neighbouring chunks
 * overlap correctly with no cross-chunk sorting, and an entity that has strayed past its border
 * (before its hand-off lands) still draws in the right order. Ground layers draw first and don't
 * touch the depth buffer.
 *
 * Draw order: ground, soft drop shadows (blended, no depth), opaque sprite cores (depth-tested and
 * written), then the sprites' anti-aliased edges (blended, depth-tested, not written) so smooth
 * art keeps soft outlines without sorting. Static props (trees, lamps…) use the same machinery
 * with their own atlas, so people walk behind and in front of them correctly.
 */
import * as PIXI from "pixi.js";
import { glowUniforms, MAX_GLOW_RAMP, MAX_GLOWS, MAX_PALETTE, paletteArray, type GlowRange } from "./tint";
import { chunkKey } from "./coord";
import { SnapshotPair } from "./interp";
import { EMPTY_SLOT, POSITION_SCALE, type Snapshot } from "./protocol";
import { StaticSet, tintTree, type StaticSpec } from "./statics";

const GL_FLOAT = 5126;
const GL_SHORT = 5122;
const GL_UNSIGNED_BYTE = 5121;
const GL_UNSIGNED_SHORT = 5123;
export { glowOf, glowUniforms, MAX_PALETTE, paletteArray, tintIndices, type GlowRange } from "./tint";
const instanceHeader = `
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

vec2 footOf() {
  return mix(vec2(aPrevX, aPrevY), vec2(aCurX, aCurY), uAlpha) / uPositionScale;
}
float growOf() {
  float pixelsPerUnit = length(vec2(translationMatrix[0][0], translationMatrix[0][1]));
  return max(1.0, uMinPixels / max(uSize.y * pixelsPerUnit, 0.0001));
}
`;

const vertex = `${instanceHeader}
uniform vec2 uGrid;
uniform vec3 uPalette[${MAX_PALETTE}];
uniform vec3 uFields;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vColor2;
varying vec3 vColor3;

void main() {
  if (aTint > ${EMPTY_SLOT - 0.5}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vColor = vColor2 = vColor3 = vec3(0.0);
    return;
  }
  vec2 foot = footOf();
  float grow = growOf();
  mat3 m = projectionMatrix * translationMatrix;
  vec3 clip = m * vec3(foot + aCorner * uSize * grow, 1.0);
  vec3 clipFoot = m * vec3(foot, 1.0);
  // Lower on screen is nearer, in every chunk alike.
  gl_Position = vec4(clip.xy, clamp(clipFoot.y * 0.5, -0.999, 0.999), 1.0);
  float column = floor(mod(aSprite + 0.5, uGrid.x));
  vec2 cell = vec2(column, floor((aSprite + 0.5) / uGrid.x));
  vUv = (cell + vec2(aCorner.x + 0.5, aCorner.y + 1.0)) / uGrid;
  if (uFields.x > 0.5) {
    // The tint byte packs up to three palette indices (e.g. clothes, hair, skin).
    float t = aTint + 0.5;
    float a = floor(mod(t, uFields.x));
    t = floor(t / uFields.x) + 0.5;
    float b = floor(mod(t, uFields.y));
    float c = floor(t / uFields.y);
    vColor = uPalette[int(a)];
    vColor2 = uPalette[int(uFields.x + b + 0.5)];
    vColor3 = uPalette[int(uFields.x + uFields.y + c + 0.5)];
  } else {
    vColor = uPalette[int(aTint + 0.5)];
    vColor2 = vColor3 = vec3(1.0);
  }
}
`;

const fragment = `
precision mediump float;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vColor2;
varying vec3 vColor3;
uniform sampler2D uAtlas;
uniform sampler2D uMask;
uniform float uMasked;
uniform float uEdges;
uniform vec3 uLight;

void main() {
  vec4 texel = texture2D(uAtlas, vUv);
  // The opaque pass draws solid cores; the edge pass blends the soft rims over them.
  if (uEdges > 0.5) {
    if (texel.a >= 0.97 || texel.a < 0.03) discard;
  } else if (texel.a < 0.97) {
    discard;
  }
  vec3 raw = texel.rgb / texel.a;
  vec3 color;
  if (uMasked > 0.5) {
    // The mask says how much of each palette colour multiplies the (greyscale-shaded) art.
    vec4 m = texture2D(uMask, vUv);
    vec3 w = clamp(m.rgb / max(m.a, 0.004), 0.0, 1.0);
    color = raw * mix(vec3(1.0), vColor, w.r) * mix(vec3(1.0), vColor2, w.g) * mix(vec3(1.0), vColor3, w.b);
  } else {
    // Opaque texels take the tint; texels drawn at about 70% alpha keep their own colour.
    float tinted = clamp((texel.a - 0.7) / 0.25, 0.0, 1.0);
    color = mix(raw, raw * vColor, tinted);
  }
  color *= uLight;
  float alpha = uEdges > 0.5 ? texel.a : 1.0;
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

const shadowVertex = `${instanceHeader}
uniform vec2 uShadowSize;
uniform vec2 uShadowOffset;
varying vec2 vLocal;

void main() {
  if (aTint > ${EMPTY_SLOT - 0.5}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLocal = vec2(9.0);
    return;
  }
  vec2 foot = footOf();
  float grow = growOf();
  vLocal = vec2(aCorner.x, aCorner.y + 0.5) * 2.0;
  mat3 m = projectionMatrix * translationMatrix;
  vec3 clip = m * vec3(foot + (vLocal * 0.5 * uShadowSize + uShadowOffset) * grow, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
`;

const shadowFragment = `
precision mediump float;
varying vec2 vLocal;
uniform float uShadowAlpha;

void main() {
  float d = length(vLocal);
  float a = uShadowAlpha * (1.0 - smoothstep(0.25, 1.0, d));
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`;

const glowVertex = `${instanceHeader}
uniform vec2 uGrid;
uniform vec4 uGlowBounds[${MAX_GLOWS}];
uniform vec4 uGlowShape[${MAX_GLOWS}];
uniform vec3 uGlowRamp[${MAX_GLOW_RAMP}];
uniform float uGlowRadius;
uniform float uGlowMinPixels;
uniform float uGlowTime;
varying vec2 vUv;
varying vec4 vCell;
varying vec2 vReach;
varying vec4 vGlow;

void main() {
  // Find this sprite's glow range (the last match wins), then its colour on that range's ramp.
  float sprite = aSprite + 0.5;
  vec4 bounds = vec4(0.0);
  vec4 shape = vec4(0.0);
  for (int i = 0; i < ${MAX_GLOWS}; i++) {
    vec4 b = uGlowBounds[i];
    if (sprite >= b.x && sprite < b.y) {
      bounds = b;
      shape = uGlowShape[i];
    }
  }
  if (aTint > ${EMPTY_SLOT - 0.5} || shape.x <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vReach = vec2(0.0);
    vCell = vGlow = vec4(0.0);
    return;
  }
  float stages = shape.z;
  float stage = 0.0;
  if (bounds.z > 0.0) stage = floor((sprite - bounds.x) / bounds.z);
  else if (bounds.w > 0.0) stage = mod(floor((aTint + 0.5) / bounds.w), stages);
  stage = clamp(stage, 0.0, stages - 1.0);
  float rampIndex = floor(shape.w) + stage;
  vec3 color = vec3(0.0);
  for (int j = 0; j < ${MAX_GLOW_RAMP}; j++) {
    if (float(j) == rampIndex) color = uGlowRamp[j];
  }
  // The last stage throbs (a host about to die), each sprite a little out of step.
  float pulse = fract(shape.w) * 2.0;
  float throb = 0.0;
  float strength = shape.x;
  if (pulse > 0.0 && stage >= stages - 1.0) {
    throb = pulse * (0.5 + 0.5 * sin(uGlowTime * 5.0 + aPrevX * 0.37 + aPrevY * 0.21));
    strength *= 1.0 - 0.3 * pulse + 0.8 * throb;
  }
  vGlow = vec4(color, strength);
  vec2 foot = footOf();
  float grow = growOf();
  float pixelsPerUnit = length(vec2(translationMatrix[0][0], translationMatrix[0][1]));
  vec2 size = uSize * grow;
  // The halo keeps a minimum width on screen, so the hive still reads far out.
  float reach = max(uGlowRadius * grow, uGlowMinPixels / max(pixelsPerUnit, 0.0001)) * shape.y * (1.0 + 0.35 * throb);
  vec2 margin = vec2(reach) / size;
  vec2 corner = aCorner * (1.0 + 2.0 * margin) + vec2(0.0, -margin.y);
  mat3 m = projectionMatrix * translationMatrix;
  vec3 clip = m * vec3(foot + corner * size, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
  float column = floor(mod(aSprite + 0.5, uGrid.x));
  vec2 cell = vec2(column, floor((aSprite + 0.5) / uGrid.x));
  vUv = (cell + vec2(corner.x + 0.5, corner.y + 1.0)) / uGrid;
  vCell = vec4(cell / uGrid, (cell + 1.0) / uGrid);
  vReach = margin / uGrid;
}
`;

const glowFragment = `
precision mediump float;
varying vec2 vUv;
varying vec4 vCell;
varying vec2 vReach;
varying vec4 vGlow;
uniform sampler2D uAtlas;

float coverage(vec2 uv) {
  if (uv.x < vCell.x || uv.y < vCell.y || uv.x > vCell.z || uv.y > vCell.w) return 0.0;
  return texture2D(uAtlas, uv).a;
}

void main() {
  // A dilated, softened silhouette: coverage sampled on two rings around the pixel.
  float a = coverage(vUv);
  float ring = 0.0;
  float near = 0.0;
  for (int i = 0; i < 10; i++) {
    float t = float(i) * 0.6283;
    vec2 d = vec2(cos(t), sin(t));
    ring += coverage(vUv + d * vReach);
    near += coverage(vUv + d * vReach * 0.45);
  }
  float halo = max(a, max(near / 10.0 * 2.4, ring / 10.0 * 1.3));
  halo = smoothstep(0.0, 1.0, clamp(halo, 0.0, 1.0)) * min(vGlow.a, 1.0);
  if (halo < 0.004) discard;
  gl_FragColor = vec4(vGlow.rgb * halo * max(vGlow.a, 1.0), halo);
}
`;

export type ChunkLayerStyle = {
  /**
   * Sprite atlas: a grid of equally sized cells, read row by row (sprite index = row × columns +
   * column). Without a `mask`, fully opaque texels are multiplied by the entity's palette colour,
   * texels at about 70% alpha (e.g. skin, outlines) are drawn as they are, and below 50% is
   * transparent.
   */
  atlas: PIXI.Texture;
  /**
   * Optional tint mask with the atlas's layout: its red, green and blue say how much of the
   * entity's first, second and third palette colour multiply each texel. The atlas alpha is then
   * plain coverage, with soft edges blended.
   */
  mask?: PIXI.Texture;
  /**
   * With a mask: how many palette entries each of the three colours chooses from. The tint byte
   * is a + b × fields[0] + c × fields[0] × fields[1]; colour a is palette[a], b is
   * palette[fields[0] + b], c is palette[fields[0] + fields[1] + c]. Tint 255 still means empty.
   */
  fields?: [number, number, number];
  /** Filter the atlas smoothly with mipmaps (drawn art) rather than nearest (pixel art). */
  smooth?: boolean;
  /** Atlas columns and rows. */
  grid: [number, number];
  /** Sprite size in world units; sprites are anchored at the bottom centre (the feet). */
  size: [number, number];
  /** RGB colours (0xRRGGBB) multiplied into the sprite, indexed by snapshot tint. */
  palette: number[];
  /** Sprites never draw smaller than this many screen pixels tall, so far zooms show dots. */
  minPixels?: number;
  /** A soft elliptical drop shadow under each sprite (world units, offset from the feet). */
  shadow?: { size: [number, number]; offset?: [number, number]; alpha?: number };
  /**
   * Soft glowing halos around the silhouettes of some sprites (e.g. one sprite set), drawn under
   * every sprite and unaffected by `setLight`. At most four ranges (see GlowRange: one colour or a
   * ramp picked by sprite offset or tint, an optional pulse and a wider ring). `radius` is in
   * world units; the halo is never thinner than `minPixels` on screen.
   */
  glow?: { radius: number; minPixels?: number; ranges: GlowRange[] };
};

/** One style's GPU programs and shared uniforms. */
class LayerKind {
  readonly program: PIXI.Program;
  readonly shared: PIXI.UniformGroup;
  readonly shadowProgram: PIXI.Program | null;
  readonly shadowShared: PIXI.UniformGroup | null;
  readonly glowProgram: PIXI.Program | null = null;
  readonly glowShared: PIXI.UniformGroup | null = null;
  readonly style: ChunkLayerStyle;

  constructor(style: ChunkLayerStyle) {
    this.style = style;
    for (const texture of [style.atlas, style.mask]) {
      if (!texture) continue;
      texture.baseTexture.scaleMode = style.smooth ? PIXI.SCALE_MODES.LINEAR : PIXI.SCALE_MODES.NEAREST;
      texture.baseTexture.mipmap = style.smooth ? PIXI.MIPMAP_MODES.ON : PIXI.MIPMAP_MODES.OFF;
    }
    this.program = PIXI.Program.from(vertex, fragment, "yage-chunk-layer");
    this.shared = new PIXI.UniformGroup({
      uPositionScale: POSITION_SCALE,
      uSize: new Float32Array(style.size),
      uMinPixels: style.minPixels ?? 2,
      uGrid: new Float32Array(style.grid),
      uPalette: paletteArray(style.palette),
      uFields: new Float32Array(style.mask && style.fields ? style.fields : [0, 0, 0]),
      uMasked: style.mask ? 1 : 0,
      uLight: new Float32Array([1, 1, 1]),
    });
    if (style.shadow) {
      this.shadowProgram = PIXI.Program.from(shadowVertex, shadowFragment, "yage-chunk-shadow");
      const alpha = style.shadow.alpha ?? 0.3;
      this.shadowShared = new PIXI.UniformGroup({
        uPositionScale: POSITION_SCALE,
        uSize: new Float32Array(style.size),
        uMinPixels: style.minPixels ?? 2,
        uShadowSize: new Float32Array(style.shadow.size),
        uShadowOffset: new Float32Array(style.shadow.offset ?? [0, 0]),
        uShadowAlpha: alpha,
      });
    } else {
      this.shadowProgram = null;
      this.shadowShared = null;
    }
    if (style.glow) {
      const glow = glowUniforms(style.glow.ranges);
      this.glowProgram = PIXI.Program.from(glowVertex, glowFragment, "yage-chunk-glow");
      this.glowShared = new PIXI.UniformGroup({
        uPositionScale: POSITION_SCALE,
        uSize: new Float32Array(style.size),
        uMinPixels: style.minPixels ?? 2,
        uGrid: new Float32Array(style.grid),
        uGlowBounds: glow.bounds,
        uGlowShape: glow.shape,
        uGlowRamp: glow.ramp,
        uGlowTime: 0,
        uGlowRadius: style.glow.radius,
        uGlowMinPixels: style.glow.minPixels ?? 2,
      });
    }
  }

  shader(edges: boolean) {
    return new PIXI.Shader(this.program, {
      uAtlas: this.style.atlas,
      uMask: this.style.mask ?? this.style.atlas,
      uAlpha: 1,
      uEdges: edges ? 1 : 0,
      shared: this.shared,
    });
  }

  /** Animation clock for pulsing glows, in seconds. */
  setTime(seconds: number) {
    if (!this.glowShared) return;
    this.glowShared.uniforms.uGlowTime = seconds % 1000;
    this.glowShared.update();
  }

  setLight(light: [number, number, number], shadow: number) {
    this.shared.uniforms.uLight = new Float32Array(light);
    this.shared.update();
    if (this.shadowShared) {
      this.shadowShared.uniforms.uShadowAlpha = (this.style.shadow!.alpha ?? 0.3) * shadow;
      this.shadowShared.update();
    }
  }
}

/** One chunk's entities as a single instanced draw (plus its edge and shadow passes). */
export class ChunkLayer extends PIXI.Mesh<PIXI.Shader> {
  readonly pair: SnapshotPair;
  /** Soft anti-aliased rims, drawn after every layer's opaque pass. */
  readonly edges: PIXI.Mesh<PIXI.Shader>;
  /** Drop shadows, drawn before any sprite; null when the style has none. */
  readonly shadow: PIXI.Mesh<PIXI.Shader> | null;
  /** Silhouette halos, drawn after shadows and before any sprite; null when the style has none. */
  readonly glow: PIXI.Mesh<PIXI.Shader> | null;
  private readonly prevX: PIXI.Buffer;
  private readonly prevY: PIXI.Buffer;
  private readonly curX: PIXI.Buffer;
  private readonly curY: PIXI.Buffer;
  private readonly sprite: PIXI.Buffer;
  private readonly tintBuffer: PIXI.Buffer;
  private extent: number;

  constructor(kind: LayerKind, extent: number, expectedInterval: number) {
    // Each layer has its own shader objects (one program, shared uniform group) for its own alpha.
    const corners = new PIXI.Buffer(new Float32Array([-0.5, -1, 0.5, -1, 0.5, 0, -0.5, 0]), true);
    const empty16 = () => new PIXI.Buffer(new Int16Array(1), false);
    const empty8 = () => new PIXI.Buffer(new Uint8Array(1), false);
    const prevX = empty16();
    const prevY = empty16();
    const curX = empty16();
    const curY = empty16();
    const sprite = new PIXI.Buffer(new Uint16Array(1), false);
    const tint = empty8();
    const geometry = new PIXI.Geometry()
      .addAttribute("aCorner", corners, 2, false, GL_FLOAT as PIXI.TYPES)
      .addAttribute("aPrevX", prevX, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aPrevY", prevY, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aCurX", curX, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aCurY", curY, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aSprite", sprite, 1, false, GL_UNSIGNED_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aTint", tint, 1, false, GL_UNSIGNED_BYTE as PIXI.TYPES, 0, 0, true)
      .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
    geometry.instanceCount = 0;
    const state = PIXI.State.for2d();
    state.depthTest = true;
    state.depthMask = true;
    state.blend = false;
    super(geometry, kind.shader(false), state);
    const edgeState = PIXI.State.for2d();
    edgeState.depthTest = true;
    edgeState.depthMask = false;
    edgeState.blend = true;
    this.edges = new PIXI.Mesh(geometry, kind.shader(true), edgeState);
    if (kind.shadowProgram) {
      const shadowState = PIXI.State.for2d();
      shadowState.depthTest = false;
      shadowState.depthMask = false;
      shadowState.blend = true;
      this.shadow = new PIXI.Mesh(geometry, new PIXI.Shader(kind.shadowProgram, { uAlpha: 1, shared: kind.shadowShared! }), shadowState);
    } else {
      this.shadow = null;
    }
    if (kind.glowProgram) {
      const glowState = PIXI.State.for2d();
      glowState.depthTest = false;
      glowState.depthMask = false;
      glowState.blend = true;
      // Additive: halos read as light, and overlapping halos in a crowd brighten together.
      glowState.blendMode = PIXI.BLEND_MODES.ADD;
      this.glow = new PIXI.Mesh(geometry, new PIXI.Shader(kind.glowProgram, { uAlpha: 1, uAtlas: kind.style.atlas, shared: kind.glowShared! }), glowState);
    } else {
      this.glow = null;
    }
    this.prevX = prevX;
    this.prevY = prevY;
    this.curX = curX;
    this.curY = curY;
    this.sprite = sprite;
    this.tintBuffer = tint;
    this.extent = extent;
    this.pair = new SnapshotPair(expectedInterval);
    for (const mesh of this.companions()) {
      mesh.eventMode = "none";
      mesh.visible = false;
      if (mesh === this) continue;
      (mesh as unknown as { extent: number }).extent = extent;
      (mesh as unknown as { _calculateBounds: () => void })._calculateBounds = this._calculateBounds.bind(mesh);
    }
  }

  /** This mesh and its edge and shadow passes. */
  companions() {
    const meshes: PIXI.Mesh<PIXI.Shader>[] = [this, this.edges];
    if (this.shadow) meshes.push(this.shadow);
    if (this.glow) meshes.push(this.glow);
    return meshes;
  }

  setPosition(x: number, y: number) {
    for (const mesh of this.companions()) mesh.position.set(x, y);
  }

  setVisible(visible: boolean) {
    for (const mesh of this.companions()) mesh.visible = visible;
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
    this.setVisible(count > 0);
  }

  get count() {
    return this.geometry.instanceCount;
  }

  /** Sets the interpolation point between the last two snapshots. */
  interpolate(now: number) {
    const alpha = this.pair.alpha(now);
    for (const mesh of this.companions()) mesh.shader.uniforms.uAlpha = alpha;
  }

  // The chunk square plus its overlap margin, instead of the single template quad.
  _calculateBounds() {
    const extent = (this as unknown as { extent?: number }).extent ?? 0;
    this._bounds.addFrame(this.transform, -extent * 0.1, -extent * 0.1, extent * 1.1, extent * 1.1);
  }

  containsPoint() {
    return false;
  }

  destroy() {
    this.edges.destroy();
    this.shadow?.destroy();
    this.glow?.destroy();
    super.destroy();
  }
}

export type ChunkSceneOptions = {
  chunkSize: number;
  style: ChunkLayerStyle;
  /**
   * Static per-chunk sprites (trees, lamps…) depth-sorted with the entities; see `setProps`. Several
   * styles give several prop sets (e.g. small props, then wide ones such as vehicles or stalls,
   * each with its own atlas and cell size); they all share the depth buffer.
   */
  props?: ChunkLayerStyle | readonly ChunkLayerStyle[];
  /** Expected milliseconds between snapshots, used until real arrivals are measured. */
  snapshotInterval?: number;
};

type ChunkView = {
  cx: number;
  cy: number;
  ground: PIXI.Container;
  /** Over the ground, under every sprite; see `setDecals`. */
  decals: PIXI.Container | null;
  layer: ChunkLayer | null;
  /** Prop set 0 (the same layer as `propSets[0]`). */
  props: ChunkLayer | null;
  /** One layer per prop style, by set index. */
  propSets: (ChunkLayer | null)[];
};

/**
 * Owns the per-chunk display objects. Add `root` to the game's viewport; feed snapshots with
 * `push` and call `update` once per frame before the viewport renders.
 */
export class ChunkScene {
  readonly root = new PIXI.Container();
  readonly groundRoot = new PIXI.Container();
  /** Per-chunk decals (road meshes…), over every chunk's ground. */
  readonly decalRoot = new PIXI.Container();
  /** Static instances' lower parts (floors, walls), under every sprite and its shadow. */
  readonly staticRoot = new PIXI.Container();
  readonly shadowRoot = new PIXI.Container();
  readonly entityRoot = new PIXI.Container();
  readonly edgeRoot = new PIXI.Container();
  /** Static instances' upper parts (roofs), over every sprite. */
  readonly overRoot = new PIXI.Container();
  /** Static instances placed at any position and angle; see `setStatics`. */
  readonly statics = new StaticSet(this.staticRoot, this.overRoot);
  readonly views = new Map<number, ChunkView>();
  private readonly entities: LayerKind;
  private readonly propKinds: LayerKind[];
  private readonly options: ChunkSceneOptions;

  constructor(options: ChunkSceneOptions) {
    this.options = options;
    this.entities = new LayerKind(options.style);
    const props = options.props ? (Array.isArray(options.props) ? options.props : [options.props]) : [];
    this.propKinds = props.map((style: ChunkLayerStyle) => new LayerKind(style));
    this.root.addChild(this.groundRoot, this.decalRoot, this.staticRoot, this.shadowRoot, this.entityRoot, this.edgeRoot, this.overRoot);
  }

  setPalette(palette: number[]) {
    this.entities.shared.uniforms.uPalette = paletteArray(palette);
    this.entities.shared.update();
  }

  /** Multiplies every sprite by `light` (RGB 0–1) and scales drop shadows by `shadow`. */
  setLight(light: [number, number, number], shadow = 1) {
    this.entities.setLight(light, shadow);
    for (const kind of this.propKinds) kind.setLight(light, shadow);
    const rgb = light.reduce((v, c) => (v << 8) | Math.round(Math.max(0, Math.min(1, c)) * 255), 0);
    if (rgb !== this.lightTint) {
      this.lightTint = rgb;
      for (const view of this.views.values()) if (view.decals) tintTree(view.decals, rgb);
    }
    this.statics.setTint(rgb);
  }

  private lightTint = 0xffffff;

  /**
   * Sets a chunk's decals: display objects in chunk-local units drawn over all ground and under
   * every sprite, tinted by `setLight` (sprites, graphics and mesh-material meshes; custom shaders
   * light themselves). The scene owns them from here; null clears them.
   */
  setDecals(cx: number, cy: number, objects: readonly PIXI.DisplayObject[] | null) {
    const view = this.view(cx, cy);
    view.decals?.destroy({ children: true });
    view.decals = null;
    if (!objects?.length) return;
    const decals = new PIXI.Container();
    decals.position.set(cx * this.options.chunkSize, cy * this.options.chunkSize);
    decals.addChild(...objects);
    tintTree(decals, this.lightTint);
    this.decalRoot.addChild(decals);
    view.decals = decals;
  }

  /**
   * Lists the static instances (world units, any angle) that touch a chunk. Every chunk an
   * instance overlaps may list it under the same id: it is built once and kept until no loaded
   * chunk lists it. Null or empty clears this chunk's listings.
   */
  setStatics(cx: number, cy: number, specs: readonly StaticSpec[] | null) {
    this.view(cx, cy);
    this.statics.list(chunkKey(cx, cy), specs ?? []);
  }

  /** The chunk's view, created on first use and positioned at the chunk's origin. */
  view(cx: number, cy: number): ChunkView {
    const key = chunkKey(cx, cy);
    let view = this.views.get(key);
    if (!view) {
      const ground = new PIXI.Container();
      ground.position.set(cx * this.options.chunkSize, cy * this.options.chunkSize);
      this.groundRoot.addChild(ground);
      view = { cx, cy, ground, decals: null, layer: null, props: null, propSets: [] };
      this.views.set(key, view);
    }
    return view;
  }

  private createLayer(kind: LayerKind, cx: number, cy: number) {
    const layer = new ChunkLayer(kind, this.options.chunkSize, this.options.snapshotInterval ?? 50);
    layer.setPosition(cx * this.options.chunkSize, cy * this.options.chunkSize);
    if (layer.shadow) this.shadowRoot.addChild(layer.shadow);
    if (layer.glow) this.shadowRoot.addChild(layer.glow);
    this.entityRoot.addChild(layer);
    this.edgeRoot.addChild(layer.edges);
    return layer;
  }

  push(snapshot: Snapshot, now = performance.now()) {
    const view = this.view(snapshot.cx, snapshot.cy);
    if (!view.layer) view.layer = this.createLayer(this.entities, snapshot.cx, snapshot.cy);
    view.layer.push(snapshot, now);
  }

  /**
   * Sets a chunk's static props (positions chunk-local in POSITION_SCALE fixed point, like a
   * snapshot), drawn with prop style `set` (default the first). Null clears them.
   */
  setProps(cx: number, cy: number, props: Snapshot | null, set = 0) {
    const kind = this.propKinds[set];
    if (!kind) throw new Error(`ChunkScene was created without props style ${set}`);
    const view = this.view(cx, cy);
    let layer = view.propSets[set] ?? null;
    if (!props) {
      layer?.destroy();
      layer = null;
    } else {
      if (!layer) layer = this.createLayer(kind, cx, cy);
      layer.push(props, 0);
      layer.interpolate(Infinity);
    }
    view.propSets[set] = layer;
    if (set === 0) view.props = layer;
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
    for (const layer of view.propSets) layer?.destroy();
    view.ground.destroy({ children: true });
    view.decals?.destroy({ children: true });
    this.statics.drop(key);
    this.views.delete(key);
  }

  /**
   * Culls chunks outside `view` (world units, expanded by one chunk for strays) and sets each
   * layer's interpolation point.
   */
  update(view: { minX: number; minY: number; maxX: number; maxY: number }, now = performance.now()) {
    const size = this.options.chunkSize;
    this.entities.setTime(now / 1000);
    let drawn = 0;
    for (const chunk of this.views.values()) {
      const x = chunk.cx * size;
      const y = chunk.cy * size;
      const inView = x + size * 1.1 >= view.minX && x - size * 0.1 <= view.maxX && y + size * 1.1 >= view.minY && y - size * 0.1 <= view.maxY;
      chunk.ground.visible = inView;
      if (chunk.decals) chunk.decals.visible = inView;
      for (const props of chunk.propSets) props?.setVisible(inView && props.count > 0);
      if (chunk.layer) {
        const visible = inView && chunk.layer.count > 0;
        chunk.layer.setVisible(visible);
        if (visible) {
          chunk.layer.interpolate(now);
          drawn += chunk.layer.count;
        }
      }
    }
    this.statics.cull(view);
    return drawn;
  }

  destroy() {
    this.statics.clear();
    this.root.destroy({ children: true });
    this.views.clear();
  }
}
