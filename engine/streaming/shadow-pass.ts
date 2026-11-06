/**
 * The sun's shadows for static instances, one pass over everything they draw (ChunkScene's
 * `castRoot`): the scene is flat, but each instance says how tall it stands, so the pass treats it
 * as 3D. Two buffers, drawn where the camera puts things:
 *
 *  - heights: every instance's `StaticParts.heights` and every props layer's (ChunkLayerStyle
 *    `heights`), seen from straight above (a building's footprint at its height, the water tower on
 *    its roof higher still, a bench's seat), reaching past the screen's edge toward the sun, so what
 *    stands just off screen still shades what's on it. Each shape keeps its top and its underside
 *    (`solidColor`): a lamp's arm or an awning stands clear of the ground, and the sun gets under it.
 *    A props layer's plans are blue besides: its sprites draw over this pass;
 *  - tops: what each screen px shows, a G-buffer (`heightColor`): every instance's
 *    `StaticParts.tops`, the roofs as the screen shows them (lifted up the screen by their walls'
 *    `rise`), each with its height and rise, and its walls' faces in `WALL_COLOR`; and every
 *    sprite's texels (`surfaces`, ChunkLayer's), in the scene's order and depth: on a props layer
 *    with a `surface` atlas each texel's height, rise and solid (`paintSurface`), else standing
 *    upright over its feet; the rest is ground, at 0;
 *  - casts: upright sprites' own shadows on the ground (ChunkLayerStyle `cast`: a tree's silhouette
 *    laid toward the sun), anything drawn marking shade.
 *
 * Drawn over the whole scene, last. One quad over the screen: each pixel finds its point on the
 * ground plan (down the screen by its rise) and marches from there toward the sun (north-west; shadows fall toward +x, +y, a unit
 * of height one unit along each) through the heights; if something stands above the ray it is in
 * shade, at the pass's darkness. So towers shade the street and the lower roofs beside them, a
 * parapet the deck inside it, a water tower the roof it stands on, and a tree the ground beside it,
 * each once however many overlap, and a sprite's texels as the ground around them, a tree's crown
 * the trunk under it. Then the shade is box blurred onto the screen, so its px steps soften.
 * The march skips, a block at a time, stretches of the heights with nothing tall enough to stand
 * over the ray there (their tallest tops, 8 and 64 heights px a side), so open ground costs a few
 * samples: the same shade, sooner.
 * A face turned from the sun (a wall's, a sprite's side), and a pixel whose own plan point is inside
 * a static standing from under it to over it (the foot of a water tower on its roof), is left as its
 * art draws it; the ground under something held up (a bus's body, a canopy) or under a sprite
 * isn't, so its shade meets them.
 *
 * Drawn the way LightPass draws its light, not through a Pixi filter, which would drop a camera
 * sitting in the projection (ProjectedCamera) for what draws after.
 */
import * as PIXI from "pixi.js";
import { renderInto } from "./window-light";

const GL_FLOAT = 5126;
/** A rise is kept to a 16th of a world px: its plan point within a screen px at any zoom. */
const RISE_FRACTION = 16;
/** The tallest rise kept (world px). */
const MAX_RISE = 512 - 1 / RISE_FRACTION;

/**
 * The fill colour a `heights` or `tops` shape is drawn in for something `height` px tall (world
 * px, to 255), its roof drawn `rise` px up the screen (to `MAX_RISE`): the rise's whole px in
 * green (its 256 in blue's bit 4), its 16ths in blue's low bits.
 */
export const heightColor = (height: number, rise = 0) => {
  const r = Math.round(Math.max(0, Math.min(MAX_RISE, rise)) * RISE_FRACTION);
  return (Math.max(0, Math.min(255, Math.round(height))) << 16) | (((r >> 4) & 255) << 8) | ((r >> 12) << 4) | (r & 15);
};

/**
 * The fill colour a `heights` shape is drawn in for a solid from `base` up to `top` (world px, to
 * 255): `base` 0 stands on the ground, above it the sun passes under (a lamp's arm, a table top).
 */
export const solidColor = (top: number, base = 0) => (Math.max(0, Math.min(255, Math.round(top))) << 16) | (Math.max(0, Math.min(255, Math.round(base))) << 8);

/** The fill colour a `tops` shape is drawn in for a wall's face (blue's high bit, a side): the sun leaves it as its art draws it. */
export const WALL_COLOR = 0x000080;

const vertex = `
precision highp float;
attribute vec2 aVertexPosition;
void main() {
  gl_Position = vec4(aVertexPosition, 0.0, 1.0);
}
`;

const STEPS = 32;
/** Heights px a side of a block the march may skip whole (`sunCoarse`). */
const COARSE = 8;
/** How far (world px) the march looks a px (or half one) at a time before stepping out further apart. */
const NEAR = 32;
/**
 * GLSL: `sunSolidId(id, salt)`, what a sprite's solid `id` (its heights atlas's blue, 1-254) is in
 * the heights buffer's blue drawn with `salt` (`saltOf`, its instance's): the same solid of two
 * sprites side by side differs. 0 is a static's.
 */
export const SUN_SOLID_ID = `
float sunSolidId(float id, float salt) {
  return 1.0 + mod(floor(id + 0.5) + floor(salt + 0.5), 254.0);
}
`;
/**
 * GLSL: `sunShade(ground, h, slack, own)`, 1 where the sun is hidden from plan point `ground` (screen
 * px) at `h` world px up by a solid over `slack` world px above its line, else 0: a march toward the
 * sun through `uSunHeights` (ShadowPass's heights), near a world px a step (half one
 * zoomed in, where a world px is several on screen: a post or a lamp's lantern is thinner than the
 * far steps, and the steps would show along its edges), then further apart out to `uSunReach`.
 * Solid `own` (`sunSolidId`, -1 for none: 0 is every static's) never hides it: a flat topped solid can't shade its own
 * top, and what of a rounded one (a crown) faces away from the sun its art shades.
 */
const SUN_SHADE = `
uniform sampler2D uSunHeights;
uniform sampler2D uSunCoarse;
uniform vec2 uSunCoarseSize;
uniform sampler2D uSunCoarser;
uniform vec2 uSunCoarserSize;
uniform vec4 uSunFrame;
uniform float uSunScale;
uniform float uSunReach;
${SUN_SOLID_ID}
vec3 sunSolid(vec2 ground, vec2 o) {
  return texture2D(uSunHeights, (ground - o * uSunScale - uSunFrame.xy) / uSunFrame.zw).rgb * 255.0;
}
float sunHides(vec3 solid, float h, vec2 o, float slack, float own) {
  float t = (o.x + o.y) * 0.5;
  return solid.x > h + t + slack && solid.y <= h + t && abs(solid.z - own) > 0.5 ? 1.0 : 0.0;
}
// The tallest top (world px) in a block of the heights (COARSE px a side, and a px past each edge:
// a sample's px is never off by more than one from the block it's reckoned in), and in a block of
// those (COARSE blocks a side, and a block past each edge); clamped to the buffer as the heights' samples are.
float sunCoarse(vec2 block) {
  return texture2D(uSunCoarse, (clamp(block, vec2(0.0), uSunCoarseSize - 1.0) + 0.5) / uSunCoarseSize).r * 255.0;
}
float sunCoarser(vec2 block) {
  return texture2D(uSunCoarser, (clamp(block, vec2(0.0), uSunCoarserSize - 1.0) + 0.5) / uSunCoarserSize).r * 255.0;
}
// The first near sample (see sunShade) past block (size heights px a side) of the heights:
// past its left edge (o.x past it) or its top edge (o.y past it).
float sunLeaves(vec2 base, vec2 block, float size, float span, float i) {
  vec2 exits = floor((base - block * size) / span) + 1.0;
  return max(min(2.0 * exits.x - 1.0, 2.0 * exits.y), i + 1.0);
}
// How far (world px) the far march stays in block (size heights px a side).
float sunStays(vec2 base, vec2 block, float size) {
  vec2 room = base - block * size;
  return min(room.x, room.y) / uSunScale;
}
float sunShade(vec2 ground, float h, float slack, float own) {
  float step = uSunScale >= 2.0 ? 0.5 : 1.0;
  // Heights px at no offset, and a step's px.
  vec2 base = ground - uSunFrame.xy;
  float span = step * uSunScale;
  // A step across, then one up: a diagonal step would pass between two solids touching at a corner.
  // Sample i is o = (ceil(i / 2), floor(i / 2)) steps out, (o.x + o.y) / 2 = i * step / 2 along.
  // Entering a block (or a block of blocks) of the heights, if nothing in it stands over the ray
  // where it comes in (the lowest the ray is in it), none of its samples can hide the sun: skip to
  // where the ray leaves it. Else its samples are tested as ever: the same shade, sooner.
  float last = ${NEAR * 2}.0 / step;
  float i = 1.0;
  float leave = 0.0;
  float leaveBig = 0.0;
  // Each turn tests a sample or skips a block, each at most one per sample.
  for (int k = 0; k < ${NEAR * 8}; k++) {
    if (i > last) break;
    vec2 o = vec2(ceil(i * 0.5), floor(i * 0.5)) * step;
    if (i >= leave) {
      vec2 at = base - o * uSunScale;
      float under = h + i * step * 0.5 + slack;
      if (i >= leaveBig) {
        vec2 big = floor(at / ${COARSE * COARSE}.0);
        leaveBig = sunLeaves(base, big, ${COARSE * COARSE}.0, span, i);
        if (sunCoarser(big) <= under) {
          i = leaveBig;
          continue;
        }
      }
      vec2 block = floor(at / ${COARSE}.0);
      leave = sunLeaves(base, block, ${COARSE}.0, span, i);
      if (sunCoarse(block) <= under) {
        i = leave;
        continue;
      }
    }
    if (sunHides(sunSolid(ground, o), h, o, slack, own) > 0.5) return 1.0;
    i += 1.0;
  }
  float reach = uSunReach - h - ${NEAR}.0;
  // Out to where the far march is known clear, and to where its block of blocks was looked at.
  float clear = 0.0;
  float looked = 0.0;
  for (int i = 1; i <= ${STEPS}; i++) {
    if (reach <= 0.0) break;
    float f = float(i) / ${STEPS}.0;
    float t = ${NEAR}.0 + f * f * reach;
    if (t <= clear) continue;
    vec2 at = base - vec2(t) * uSunScale;
    float under = h + t + slack;
    if (t > looked) {
      vec2 big = floor(at / ${COARSE * COARSE}.0);
      looked = sunStays(base, big, ${COARSE * COARSE}.0);
      if (sunCoarser(big) <= under) {
        clear = looked;
        continue;
      }
    }
    vec2 block = floor(at / ${COARSE}.0);
    if (sunCoarse(block) <= under) {
      clear = sunStays(base, block, ${COARSE}.0);
      continue;
    }
    if (sunHides(sunSolid(ground, vec2(t)), h, vec2(t), slack, own) > 0.5) return 1.0;
  }
  return 0.0;
}
`;
/**
 * The heights' tallest tops, a px a block of COARSE heights px a side (and the px around it), so the
 * march skips the open stretches a block at a time (`sunCoarse`).
 */
const coarseFragment = `
precision highp float;
uniform sampler2D uHeights;
uniform vec2 uSize;
void main() {
  vec2 block = floor(gl_FragCoord.xy) * ${COARSE}.0;
  float top = 0.0;
  for (int y = -1; y <= ${COARSE}; y++)
    for (int x = -1; x <= ${COARSE}; x++) top = max(top, texture2D(uHeights, (block + vec2(float(x), float(y)) + 0.5) / uSize).r);
  gl_FragColor = vec4(top, 0.0, 0.0, 1.0);
}
`;
const fragment = `
precision highp float;
uniform sampler2D uTops;
uniform sampler2D uCasts;
uniform vec2 uView;
uniform float uRes;
${SUN_SHADE}
void main() {
  vec2 p = vec2(gl_FragCoord.x, uView.y * uRes - gl_FragCoord.y) / uRes;
  // The G-buffer is upside down, as the screen is (its depth orders as the scene's does).
  vec4 top = floor(texture2D(uTops, vec2(p.x / uView.x, 1.0 - p.y / uView.y)) * 255.0 + 0.5);
  // A face turned from the sun: as its art draws it.
  if (top.b >= 128.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  float h = top.r;
  float rise = top.g + 256.0 * mod(floor(top.b / 16.0), 2.0) + mod(top.b, 16.0) / ${RISE_FRACTION}.0;
  vec2 ground = p + vec2(0.0, rise * uSunScale);
  float shade = 0.0;
  if (top.a > 0.5 && top.a < 254.5) {
    // A sprite's texel on its solid (alpha): never shaded by that solid, a px of slack (its height
    // and plan point are each rounded to within half a px).
    shade = sunShade(ground, h, 1.0, top.a);
  } else {
    // What stands at our own plan point: its top, its underside and (blue) whether it's a sprite's.
    vec4 own = texture2D(uSunHeights, (ground - uSunFrame.xy) / uSunFrame.zw);
    float tol = h < 0.5 ? 0.5 : 1.5;
    bool inside = own.r * 255.0 > h + tol && own.g * 255.0 <= h + tol;
    // Inside a static standing from under us up: its body, as its art draws it. Ground under a
    // thing held up (a bus's body over its wheels, a canopy) marches like any other. Ground inside
    // a sprite's plan is under it, in its shade: where its plan reaches a hair past its art that's
    // the foot of its shadow.
    if (inside && own.b > 0.5 / 255.0) shade = 1.0;
    bool covered = inside && own.b < 0.5 / 255.0;
    // Sprites' shadows lie on open ground only, never up a wall or over a roof.
    if (h < 0.5 && !covered) shade = max(shade, texture2D(uCasts, p / uView).a);
    if (!covered && shade < 1.0) shade = max(shade, sunShade(ground, h, 0.5, -1.0));
  }
  gl_FragColor = vec4(0.0, 0.0, 0.0, shade);
}
`;
/** How far (screen px) the shade's box blur reaches each way, at most. */
const BLUR = 2;
/**
 * The shade laid on the screen through a box `uBlur` px each way (`BLUR` at most): a shadow's
 * edge, stepped by the heights' px, softens over a px or two.
 */
const blurFragment = `
precision highp float;
uniform sampler2D uShade;
uniform vec2 uView;
uniform float uRes;
uniform float uBlur;
uniform float uDarkness;
void main() {
  vec2 at = floor(gl_FragCoord.xy / uRes) + 0.5;
  float sum = 0.0;
  float n = 0.0;
  for (int i = -${BLUR}; i <= ${BLUR}; i++)
    for (int j = -${BLUR}; j <= ${BLUR}; j++) {
      if (abs(float(i)) > uBlur || abs(float(j)) > uBlur) continue;
      sum += texture2D(uShade, (at + vec2(float(i), float(j))) / uView).a;
      n += 1.0;
    }
  gl_FragColor = vec4(0.0, 0.0, 0.0, sum / n * uDarkness);
}
`;

/**
 * A sprite atlas's surfaces for the sun (ChunkLayerStyle `surface`), from its art and its heights
 * atlas (same grid, `per` px a world unit, the heights `lift` world units down from the art): each
 * opaque texel's height (world px), its rise up the screen (`heightColor`'s), whether it's on a side
 * (blue's high bit; else a top) and the solid it's on (alpha, the heights' blue: 1-254), what its
 * own view ray down through its cell's heights meets first, heights standing `rise` world px up the
 * screen a world px tall. A texel that meets nothing (a fringe past the plan) takes its nearest
 * neighbour's within a few px, else it lies on the ground where it draws, on no solid (255). Not
 * premultiplied: upload it as is (`PIXI.ALPHA_MODES.NPM`).
 */
export const paintSurface = (art: ImageData, heights: ImageData, cell: [number, number], per: number, lift: number, rise: number) => {
  const { width, height } = art;
  const a = art.data, hd = heights.data;
  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  const od = out.data;
  const found = new Uint8Array(width * height);
  const shift = Math.round(lift * per);
  // A row of cells at a time, each texel's nearest solid heights texel at or above it in its column within the cell
  // (-1: none): a view ray skips the open heights between solids instead of stepping through them a px at a time.
  const [cw, ch] = cell;
  const solidAt = new Int32Array(ch * width);
  let queue = new Int32Array(1024), queued = 0;
  for (let y0 = 0; y0 < height; y0 += ch) {
    const y1 = Math.min(height, y0 + ch);
    for (let x = 0; x < width; x++) {
      let last = -1;
      for (let hy = y0; hy < y1; hy++) {
        if (hd[4 * (hy * width + x) + 3] >= 128) last = hy;
        solidAt[(hy - y0) * width + x] = last;
      }
    }
    for (let y = y0; y < y1; y++) for (let x = 0; x < width; x++) {
      const k = y * width + x;
      if (a[4 * k + 3] < 8) continue;
      // Down the view ray from the far end of the cell: the first solid it's inside is the nearest.
      // (Only solid heights texels can stop it: one past a stretch of open ones meets them with none above.)
      const end = Math.max(y0, y - shift);
      let hy = y0 + ch - 1, above = false;
      while (hy >= end) {
        if (hy >= y1) { hy--; above = false; continue; }
        const next = solidAt[(hy - y0) * width + x];
        if (next !== hy) {
          above = false;
          hy = next;
          if (hy < end) break;
        }
        const up = hy - (y - shift);
        const j = 4 * (hy * width + x);
        const top = hd[j], base = hd[j + 1], at = up / per / rise;
        // Within a px of the solid, on it: never a hair under or over what it stands on.
        if (base <= at + 1 && top >= at - 1) {
          const z = Math.min(top, Math.max(base, at));
          // Meeting it over half a px above its top, or over a solid's plan the step before and higher
          // than this one's top, it's come down onto its top; else in through its side (from open
          // ground, or from under something), on its face.
          const onTop = at > top + 0.5 || (above && (up + 1) / per / rise > top);
          const color = heightColor(z, onTop ? up / per : 0);
          od[4 * k] = color >> 16;
          od[4 * k + 1] = (color >> 8) & 255;
          od[4 * k + 2] = onTop ? color & 255 : 128;
          od[4 * k + 3] = Math.min(254, Math.max(1, hd[j + 2]));
          found[k] = 1;
          if (queued === queue.length) { const grown = new Int32Array(queued * 2); grown.set(queue); queue = grown; }
          queue[queued++] = k;
          break;
        }
        above = true;
        hy--;
      }
    }
  }
  // Fringes: the nearest surface, a px a round.
  let next = new Int32Array(Math.max(1024, queued)), nexted = 0;
  const spread = (k: number, n: number) => {
    if (found[n] || a[4 * n + 3] < 8) return;
    found[n] = 1;
    od.copyWithin(4 * n, 4 * k, 4 * k + 4);
    if (nexted === next.length) { const grown = new Int32Array(nexted * 2); grown.set(next); next = grown; }
    next[nexted++] = n;
  };
  for (let round = 0; round < 4 && queued; round++) {
    nexted = 0;
    for (let q = 0; q < queued; q++) {
      const k = queue[q], x = k % width, y = (k - x) / width;
      const cx = Math.floor(x / cw), cy = Math.floor(y / ch);
      if (x + 1 < width && Math.floor((x + 1) / cw) === cx) spread(k, k + 1);
      if (x > 0 && Math.floor((x - 1) / cw) === cx) spread(k, k - 1);
      if (y + 1 < height && Math.floor((y + 1) / ch) === cy) spread(k, k + width);
      if (y > 0 && Math.floor((y - 1) / ch) === cy) spread(k, k - width);
    }
    [queue, next] = [next, queue];
    queued = nexted;
  }
  for (let k = 0; k < width * height; k++) if (!found[k] && a[4 * k + 3] >= 8) { od[4 * k] = 0; od[4 * k + 1] = 0; od[4 * k + 2] = 0; od[4 * k + 3] = 255; }
  return out;
};

let program: PIXI.Program | null = null;
let depthWrite: PIXI.State | null = null;
let blurProgram: PIXI.Program | null = null;
let coarseProgram: PIXI.Program | null = null;

const bufferOf = () => {
  const buffer = PIXI.RenderTexture.create({ width: 1, height: 1, resolution: 1 });
  buffer.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
  return buffer;
};

export class ShadowPass extends PIXI.Container {
  /** How dark a shadow lies, 0–1. */
  darkness = 0.2;
  /**
   * Zoomed out (screen px per world px), shadows a px or two long: fading out from `fade[1]` down to
   * `fade[0]`, and below that the pass doesn't run at all (its buffers cost the same at any zoom).
   * [0, 0]: shadows at every zoom.
   */
  fade: [number, number] = [0, 0];
  /** The tallest anything stands (world px, to 255): how far toward the sun a pixel looks. */
  reach = 160;
  /** Instances' heights, from above (StaticSet adds them). */
  readonly heights = new PIXI.Container();
  /** Instances' tops, as the screen shows them (StaticSet adds them). */
  readonly tops = new PIXI.Container();
  /** Sprites' surfaces, as the screen shows them, depth-tested as the sprites are (ChunkScene adds them, ChunkLayer `surface`). */
  readonly surfaces = new PIXI.Container();
  /** Roofs' depth occluders (StaticSet adds them, with depth-sorted roofs): a sprite they hide is hidden in the tops too. */
  readonly occluders = new Set<PIXI.DisplayObject>();
  /** Upright sprites' shadows on the ground, as the screen shows them (ChunkScene adds them, ChunkLayerStyle `cast`). */
  readonly casts = new PIXI.Container();
  private readonly heightBuffer = bufferOf();
  private readonly topBuffer = bufferOf();
  private readonly castBuffer = bufferOf();
  private readonly shadeBuffer = bufferOf();
  private readonly coarseBuffer = bufferOf();
  private readonly coarseSize = new Float32Array([1, 1]);
  private readonly coarserBuffer = bufferOf();
  private readonly coarserSize = new Float32Array([1, 1]);
  private readonly heightSize = new Float32Array([1, 1]);
  private readonly view = new Float32Array([1, 1]);
  private readonly frame = new Float32Array([0, 0, 1, 1]);
  private readonly quad: PIXI.Mesh<PIXI.Shader>;
  private readonly blur: PIXI.Mesh<PIXI.Shader>;
  private readonly coarse: PIXI.Mesh<PIXI.Shader>;
  private readonly coarser: PIXI.Mesh<PIXI.Shader>;

  /** `roofsUnder`: the roofs draw under the sprites, depth-sorted (ChunkScene's `roofDepth`); else over them. */
  constructor(private readonly roofsUnder = false) {
    super();
    this.eventMode = "none";
    this.addChild(this.heights, this.tops, this.surfaces, this.casts);
    this.topBuffer.framebuffer.enableDepth();
    program ??= PIXI.Program.from(vertex, fragment, "yage-shadow-pass");
    // The whole screen, in clip space.
    const geometry = new PIXI.Geometry().addAttribute("aVertexPosition", [-1, -1, 1, -1, 1, 1, -1, 1], 2, false, GL_FLOAT as PIXI.TYPES).addIndex([0, 1, 2, 0, 2, 3]);
    const shader = new PIXI.Shader(program, { uSunHeights: this.heightBuffer, uTops: this.topBuffer, uCasts: this.castBuffer, uView: this.view, uRes: 1, uSunCoarse: this.coarseBuffer, uSunCoarseSize: this.coarseSize, uSunCoarser: this.coarserBuffer, uSunCoarserSize: this.coarserSize, uSunFrame: this.frame, uSunScale: 1, uSunReach: this.reach });
    this.quad = new PIXI.Mesh(geometry, shader);
    blurProgram ??= PIXI.Program.from(vertex, blurFragment, "yage-shadow-blur");
    this.blur = new PIXI.Mesh(geometry, new PIXI.Shader(blurProgram, { uShade: this.shadeBuffer, uView: this.view, uRes: 1, uBlur: 1, uDarkness: this.darkness }));
    coarseProgram ??= PIXI.Program.from(vertex, coarseFragment, "yage-shadow-coarse");
    this.coarse = new PIXI.Mesh(geometry, new PIXI.Shader(coarseProgram, { uHeights: this.heightBuffer, uSize: this.heightSize }));
    this.coarser = new PIXI.Mesh(geometry, new PIXI.Shader(coarseProgram, { uHeights: this.coarseBuffer, uSize: this.coarseSize }));
  }

  render(renderer: PIXI.Renderer) {
    const shown = (c: PIXI.DisplayObject) => c.visible;
    if (!this.visible || this.darkness <= 0.002 || !(this.heights.children.some(shown) || this.casts.children.some(shown))) return;
    const { width, height } = renderer.screen;
    // Screen px per world px, where the camera and this pass's parents put the instances.
    const m = renderer.projection.projectionMatrix;
    const t = this.worldTransform;
    const scale = (Math.hypot(m.a, m.b) * Math.hypot(t.a, t.b) * width) / 2;
    const [low, high] = this.fade;
    const faded = scale >= high ? 1 : scale <= low ? 0 : (scale - low) / (high - low);
    if (faded <= 0) return;
    // The heights reach past the screen toward the sun, and down it by the tallest rise (a roof at
    // the screen's foot stands on ground below it).
    const toward = Math.ceil(this.reach * scale);
    const below = Math.ceil(MAX_RISE * scale);
    const frame = new PIXI.Rectangle(-toward, -toward, Math.ceil(width) + toward, Math.ceil(height) + toward + below);
    size(this.heightBuffer, frame.width, frame.height);
    size(this.topBuffer, width, height);
    size(this.castBuffer, width, height);
    size(this.shadeBuffer, width, height);
    renderInto(renderer, this.heightBuffer, [0, 0, 0, 0], () => this.heights.render(renderer), frame);
    // Their tallest tops a block at a time, for the march to skip open stretches by.
    this.heightSize[0] = this.heightBuffer.width;
    this.heightSize[1] = this.heightBuffer.height;
    size(this.coarseBuffer, Math.ceil(this.heightBuffer.width / COARSE), Math.ceil(this.heightBuffer.height / COARSE));
    this.coarseSize[0] = this.coarseBuffer.width;
    this.coarseSize[1] = this.coarseBuffer.height;
    renderInto(renderer, this.coarseBuffer, [0, 0, 0, 0], () => this.coarse.render(renderer));
    size(this.coarserBuffer, Math.ceil(this.coarseBuffer.width / COARSE), Math.ceil(this.coarseBuffer.height / COARSE));
    this.coarserSize[0] = this.coarserBuffer.width;
    this.coarserSize[1] = this.coarserBuffer.height;
    renderInto(renderer, this.coarserBuffer, [0, 0, 0, 0], () => this.coarser.render(renderer));
    // In the scene's order: roofs under the sprites (their occluders hiding those behind them) or over them.
    // Depth writes on, or its clear leaves the depth as it was.
    renderer.batch.flush();
    renderer.state.set((depthWrite ??= Object.assign(PIXI.State.for2d(), { depthTest: true, depthMask: true })));
    renderInto(
      renderer,
      this.topBuffer,
      [0, 0, 0, 0],
      () => {
        if (this.roofsUnder) {
          this.tops.render(renderer);
          for (const occluder of this.occluders) {
            if (occluder.destroyed) this.occluders.delete(occluder);
            else if (occluder.worldVisible) occluder.render(renderer);
          }
          this.surfaces.render(renderer);
        } else {
          this.surfaces.render(renderer);
          this.tops.render(renderer);
        }
      },
      undefined,
      true,
    );
    renderInto(renderer, this.castBuffer, [0, 0, 0, 0], () => this.casts.render(renderer));
    this.view[0] = width;
    this.view[1] = height;
    this.frame[0] = frame.x;
    this.frame[1] = frame.y;
    this.frame[2] = frame.width;
    this.frame[3] = frame.height;
    const uniforms = this.quad.shader.uniforms;
    // The shade a screen px (CSS) a buffer px, then blurred onto the screen.
    uniforms.uRes = 1;
    uniforms.uSunScale = scale;
    uniforms.uSunReach = Math.min(255, this.reach);
    renderInto(renderer, this.shadeBuffer, [0, 0, 0, 0], () => this.quad.render(renderer));
    Object.assign(this.blur.shader.uniforms, { uRes: renderer.view.width / width, uBlur: scale >= 2 ? 2 : 1, uDarkness: this.darkness * faded });
    this.blur.render(renderer);
    renderer.batch.flush();
  }

  destroy(options?: PIXI.IDestroyOptions | boolean) {
    super.destroy(options);
    this.occluders.clear();
    this.heightBuffer.destroy(true);
    this.topBuffer.destroy(true);
    this.castBuffer.destroy(true);
    this.shadeBuffer.destroy(true);
    this.coarseBuffer.destroy(true);
    this.coarserBuffer.destroy(true);
    this.quad.destroy();
    this.coarse.destroy();
    this.coarser.destroy();

    this.blur.destroy();
  }
}

const size = (buffer: PIXI.RenderTexture, width: number, height: number) => {
  if (buffer.width !== Math.ceil(width) || buffer.height !== Math.ceil(height)) buffer.resize(Math.ceil(width), Math.ceil(height));
};
