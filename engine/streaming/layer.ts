/**
 * Draws streamed chunks in one Pixi viewport.
 *
 * Each chunk's entities are one instanced, depth-tested mesh positioned at the chunk's origin.
 * Depth comes from each entity's on-screen foot position, so entities from neighbouring chunks
 * overlap correctly with no cross-chunk sorting, and an entity that has strayed past its border
 * (before its hand-off lands) still draws in the right order. Ground layers draw first and don't
 * touch the depth buffer.
 *
 * Draw order: ground, (depth-sorted roofs, see `roofDepth`), soft drop shadows (blended, no depth), opaque sprite cores (depth-tested and
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
/** A sitter's height (fraction of standing) and how far its feet drop below the seat (of its height). */
const SIT_HEIGHT = 0.82;
const SIT_DROP = 0.12;
/** How much of a sleeper shows above the covers (of its height, from the top). */
const TUCKED = 0.55;


/**
 * How an entity is posed; see `ChunkLayer.setPoses`. SitLeft is a sitter facing left (drawn
 * mirrored). Fallen lies turned like Lie but uncovered (down on the ground, not in a bed). Hunch is
 * bent over: the whole figure tilted rigidly about its feet by `turn` radians (negative leans left);
 * never sheared or squashed, and never animated by the layer (callers swap poses or move parts).
 */
export const POSE = { Stand: 0, Lie: 1, Sit: 2, SitLeft: 3, Fallen: 4, Hunch: 5 } as const;
export type PoseKind = (typeof POSE)[keyof typeof POSE];
export type PoseEntry = { slot: number; pose: PoseKind; turn: number };

const instanceHeader = `
precision highp float;
uniform float uTime;
attribute vec2 aCorner;
attribute float aPrevX;
attribute float aPrevY;
attribute float aCurX;
attribute float aCurY;
attribute float aSprite;
attribute float aTint;
attribute vec2 aPose;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform float uAlpha;
uniform float uPositionScale;
uniform vec2 uSize;
uniform float uMinPixels;

vec2 footOf() {
  return mix(vec2(aPrevX, aPrevY), vec2(aCurX, aCurY), uAlpha) / uPositionScale;
}
// A pose (see ChunkLayer.setPoses) moves the sprite's corners about its feet: lying, the quad
// turns by aPose.y about its middle, which lands on the feet (a sleeper centred on the bed);
// sitting, it is shortened onto the seat, mirrored when it faces left; fallen, it turns like a
// sleeper but nothing covers it; hunched, it tilts rigidly about its feet by aPose.y radians.
vec2 posedOf(vec2 corner, vec2 size) {
  vec2 p = corner * size;
  float kind = floor(aPose.x + 0.5);
  if (kind > 4.5) {
    float s = sin(aPose.y);
    float k = cos(aPose.y);
    return vec2(k * p.x - s * p.y, s * p.x + k * p.y);
  }
  if (kind == 1.0 || kind == 4.0) {
    vec2 c = p + vec2(0.0, 0.5 * size.y);
    float s = sin(aPose.y);
    float k = cos(aPose.y);
    return vec2(k * c.x - s * c.y, s * c.x + k * c.y);
  }
  if (kind == 2.0 || kind == 3.0) {
    p.y = p.y * ${SIT_HEIGHT.toFixed(2)} + ${SIT_DROP.toFixed(2)} * size.y;
    if (kind == 3.0) p.x = -p.x;
  }
  return p;
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
varying float vTucked;

void main() {
  // A sleeper is tucked in: the bed covers it below the chest (see the fragment shader).
  vTucked = aPose.x > 0.5 && aPose.x < 1.5 ? aCorner.y + 1.0 : -1.0;
  if (aTint > ${EMPTY_SLOT - 0.5}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vColor = vColor2 = vColor3 = vec3(0.0);
    return;
  }
  vec2 foot = footOf();
  float grow = growOf();
  mat3 m = projectionMatrix * translationMatrix;
  vec3 clip = m * vec3(foot + posedOf(aCorner, uSize * grow), 1.0);
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
varying float vTucked;
uniform sampler2D uAtlas;
uniform sampler2D uMask;
uniform float uMasked;
uniform float uEdges;
uniform vec3 uLight;

void main() {
  if (vTucked > ${TUCKED.toFixed(2)}) discard;
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
  if (aTint > ${EMPTY_SLOT - 0.5} || (aPose.x > 0.5 && aPose.x < 1.5) || (aPose.x > 3.5 && aPose.x < 4.5)) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vLocal = vec2(9.0);
    return;
  }
  vec2 foot = footOf();
  float grow = growOf();
  vLocal = vec2(aCorner.x, aCorner.y + 0.5) * 2.0;
  mat3 m = projectionMatrix * translationMatrix;
  vec3 clip = m * vec3(foot + (vLocal * 0.5 * uShadowSize + uShadowOffset) * grow, 1.0);
  // The feet's depth: only tested with depth-sorted roofs (a roof hides the shadows behind it).
  vec3 clipFoot = m * vec3(foot, 1.0);
  gl_Position = vec4(clip.xy, clamp(clipFoot.y * 0.5, -0.999, 0.999), 1.0);
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
  vec3 clip = m * vec3(foot + posedOf(corner, size), 1.0);
  vec3 clipFoot = m * vec3(foot, 1.0);
  gl_Position = vec4(clip.xy, clamp(clipFoot.y * 0.5, -0.999, 0.999), 1.0);
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
      uTime: 0,
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
        uTime: 0,
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
        uTime: 0,
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
    const t = seconds % 1000;
    this.shared.uniforms.uTime = t;
    this.shared.update();
    if (this.shadowShared) {
      this.shadowShared.uniforms.uTime = t;
      this.shadowShared.update();
    }
    if (!this.glowShared) return;
    this.glowShared.uniforms.uGlowTime = t;
    this.glowShared.uniforms.uTime = t;
    this.glowShared.update();
  }

  setLight(light: [number, number, number], shadow: number) {
    this.shared.uniforms.uLight = new Float32Array(light);
    this.shared.update();
    if (this.shadowShared) {
      const configuration = this.style.shadow;
      if (!configuration) throw new Error("Chunk shadow uniforms require a shadow style");
      this.shadowShared.uniforms.uShadowAlpha = (configuration.alpha ?? 0.3) * shadow;
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
  private readonly poseBuffer: PIXI.Buffer;
  private poseData = new Float32Array(2);
  private poses: readonly PoseEntry[] = [];
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
    const pose = new PIXI.Buffer(new Float32Array(2), false);
    const geometry = new PIXI.Geometry()
      .addAttribute("aCorner", corners, 2, false, GL_FLOAT as PIXI.TYPES)
      .addAttribute("aPrevX", prevX, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aPrevY", prevY, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aCurX", curX, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aCurY", curY, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aSprite", sprite, 1, false, GL_UNSIGNED_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aTint", tint, 1, false, GL_UNSIGNED_BYTE as PIXI.TYPES, 0, 0, true)
      .addAttribute("aPose", pose, 2, false, GL_FLOAT as PIXI.TYPES, 0, 0, true)
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
      const shared = kind.shadowShared;
      if (!shared) throw new Error("Chunk shadow program requires shared uniforms");
      const shadowState = PIXI.State.for2d();
      shadowState.depthTest = false;
      shadowState.depthMask = false;
      shadowState.blend = true;
      this.shadow = new PIXI.Mesh(geometry, new PIXI.Shader(kind.shadowProgram, { uAlpha: 1, shared }), shadowState);
    } else {
      this.shadow = null;
    }
    if (kind.glowProgram) {
      const shared = kind.glowShared;
      if (!shared) throw new Error("Chunk glow program requires shared uniforms");
      const glowState = PIXI.State.for2d();
      glowState.depthTest = false;
      glowState.depthMask = false;
      glowState.blend = true;
      // Additive: halos read as light, and overlapping halos in a crowd brighten together.
      glowState.blendMode = PIXI.BLEND_MODES.ADD;
      this.glow = new PIXI.Mesh(geometry, new PIXI.Shader(kind.glowProgram, { uAlpha: 1, uAtlas: kind.style.atlas, shared }), glowState);
    } else {
      this.glow = null;
    }
    this.prevX = prevX;
    this.prevY = prevY;
    this.curX = curX;
    this.curY = curY;
    this.sprite = sprite;
    this.tintBuffer = tint;
    this.poseBuffer = pose;
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
    this.writePoses();
    this.setVisible(count > 0);
  }

  get count() {
    return this.geometry.instanceCount;
  }

  /**
   * Poses some slots (lying turned by `turn` radians, clockwise on screen, from upright; sitting);
   * every other slot stands. Kept across snapshots until the next call, so a slot keeps its pose
   * while the snapshots that move it arrive between pose updates.
   */
  setPoses(poses: readonly PoseEntry[]) {
    this.poses = poses;
    this.writePoses();
  }

  /** The pose data per instance (mode, turn), for tests. */
  get poseArray(): Float32Array {
    return this.poseData.subarray(0, this.geometry.instanceCount * 2);
  }

  private writePoses() {
    const count = Math.max(1, this.geometry.instanceCount);
    if (this.poseData.length < count * 2) this.poseData = new Float32Array(count * 2);
    else this.poseData.fill(0);
    for (const p of this.poses) {
      if (p.slot >= count) continue;
      this.poseData[p.slot * 2] = p.pose;
      this.poseData[p.slot * 2 + 1] = p.turn;
    }
    this.poseBuffer.update(this.poseData.subarray(0, count * 2));
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
  /**
   * Depth-sorted roofs: static instances' over parts draw before the sprites, each hiding the
   * sprites behind its near edge by depth (see statics.ts), so people in front of a building draw
   * over its roof and people inside stay under it. Drop shadows and glows are depth-tested too.
   */
  roofDepth?: boolean;
  /**
   * When static instances build their parts: "listed" (default) as soon as a chunk lists them,
   * "seen" the first time one is in view, so a streamed-in ring of chunks costs nothing until the
   * camera reaches it.
   */
  buildStatics?: "listed" | "seen";
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
  readonly statics: StaticSet;
  readonly views = new Map<number, ChunkView>();
  private readonly entities: LayerKind;
  private readonly propKinds: LayerKind[];
  private readonly options: ChunkSceneOptions;

  constructor(options: ChunkSceneOptions) {
    this.options = options;
    this.statics = new StaticSet(this.staticRoot, this.overRoot, !!options.roofDepth, options.buildStatics === "seen");
    this.entities = new LayerKind(options.style);
    const props = options.props ? (Array.isArray(options.props) ? options.props : [options.props]) : [];
    this.propKinds = props.map((style: ChunkLayerStyle) => new LayerKind(style));
    if (options.roofDepth) this.root.addChild(this.groundRoot, this.decalRoot, this.staticRoot, this.overRoot, this.shadowRoot, this.entityRoot, this.edgeRoot);
    else this.root.addChild(this.groundRoot, this.decalRoot, this.staticRoot, this.shadowRoot, this.entityRoot, this.edgeRoot, this.overRoot);
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

  /** An independently owned pawn layer for scene-authored figures, using this scene's style. */
  createPawnLayer(cx: number, cy: number, expectedInterval = 50) {
    return this.createLayer(this.entities, cx, cy, expectedInterval);
  }

  private createLayer(kind: LayerKind, cx: number, cy: number, expectedInterval = this.options.snapshotInterval ?? 50) {
    const layer = new ChunkLayer(kind, this.options.chunkSize, expectedInterval);
    layer.setPosition(cx * this.options.chunkSize, cy * this.options.chunkSize);
    if (this.options.roofDepth) for (const pass of [layer.shadow, layer.glow]) if (pass) pass.state.depthTest = true;
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

  /** Poses a chunk's entities (see `ChunkLayer.setPoses`); nothing until its layer exists. */
  setPoses(cx: number, cy: number, poses: readonly PoseEntry[]) {
    this.views.get(chunkKey(cx, cy))?.layer?.setPoses(poses);
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
