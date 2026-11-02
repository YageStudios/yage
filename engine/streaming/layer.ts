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
 * art keeps soft outlines without sorting, (roofs), then the sun's shadows over all of it (one
 * deferred pass, shadow-pass.ts). Static props (trees, lamps…) use the same machinery
 * with their own atlas, so people walk behind and in front of them correctly.
 */
import * as PIXI from "pixi.js";
import { glowUniforms, MAX_GLOW_RAMP, MAX_GLOWS, MAX_PALETTE, paletteArray, type GlowRange } from "./tint";
import { chunkKey } from "./coord";
import { SnapshotPair } from "./interp";
import { Facings } from "./facing";
import { EMPTY_SLOT, POSITION_SCALE, type Snapshot } from "./protocol";
import { FarBake, type FarBakeOptions } from "./far";
import { StaticSet, tintTree, type StaticSpec } from "./statics";
import { LightPass, lightUniforms } from "./window-light";
import { ShadowPass, SUN_SOLID_ID } from "./shadow-pass";

const GL_FLOAT = 5126;
const GL_SHORT = 5122;
const GL_UNSIGNED_BYTE = 5121;
const GL_UNSIGNED_SHORT = 5123;
export { glowOf, glowUniforms, MAX_PALETTE, paletteArray, tintIndices, type GlowRange } from "./tint";
/** A sitter's height (fraction of standing) and how far its feet drop below the seat (of its height). */
const SIT_HEIGHT = 0.82;
const SIT_DROP = 0.12;
/**
 * A kneeler's cut (of its height above the feet, at its middle), half its art's width (of the quad's),
 * how far its top leans forward over its knees and a rigged kneeler's head hangs forward about its
 * neck (radians): see POSE.Kneel.
 */
const KNEEL_CUT = 0.26;
const KNEEL_HALF = 0.25;
const KNEEL_LEAN = 0.45;
const KNEEL_BOW = 0.7;
/** At most this many rigged sprite ranges (ChunkLayerStyle `rig`). */
export const MAX_RIGS = 8;
// A kneeler (POSE.Kneel) is drawn as its body in two pieces (aPiece 0, 1), each keeping its side of a
// cut falling to the front through KNEEL_CUT of its height above the feet (kneelCut): the top leans
// KNEEL_LEAN forward about the cut's middle, the bottom is mirrored across the line at 45 degrees through it,
// so it lies flat behind, and the cut (45 degrees less half the lean) is the angle that keeps the two cut
// faces meeting exactly (a mitre, the top leaning over the front). Its feet stay where it
// stands; the L sits on the ground at the art's sides (KNEEL_HALF of the quad's width from its middle).
// A rigged sprite (ChunkLayerStyle `rig`) kneels in its rig's parts: the body (headless) cut so, its head
// (aPiece 2) and the hair behind it (aPiece 3, looking at the viewer) whole, hung forward KNEEL_BOW about
// the neck. It is drawn in them too whenever it turns any way but to the viewer (aLook, LOOK, or the way
// it walks with the rig's \`follow\`): body and head together, side on (mirrored, looking left) or from behind.
const KNEEL_GLSL = `
const float KNEEL_CUT = ${KNEEL_CUT.toFixed(3)};
const float KNEEL_HALF = ${KNEEL_HALF.toFixed(3)};
const float KNEEL_BOW = ${KNEEL_BOW.toFixed(3)};
const float KNEEL_LEAN = ${KNEEL_LEAN.toFixed(3)};
const float KNEEL_SLOPE = ${Math.tan(Math.PI / 4 - KNEEL_LEAN / 2).toFixed(4)};
// How far past a kneeler's piece's side of the cut a point c is (quad corner units, y up from the feet;
// aspect: width over height): above 0 is not drawn.
float kneelCut(vec2 c, float aspect, float piece) {
  float mitre = c.y + KNEEL_CUT - KNEEL_SLOPE * aspect * c.x;
  return piece > 0.5 ? -mitre : mitre;
}
// p turned a radians about o, its top toward the front.
vec2 turnAbout(vec2 p, vec2 o, float a) {
  vec2 d = p - o;
  float s = sin(a);
  float k = cos(a);
  return o + vec2(k * d.x - s * d.y, s * d.x + k * d.y);
}
`;
/** How much of a sleeper shows above the covers (of its height, from the top). */
const TUCKED = 0.5;


/**
 * How an entity is posed; see `ChunkLayer.setPoses`. SitLeft is a sitter facing left (drawn
 * mirrored). Fallen lies turned like Lie but uncovered (down on the ground, not in a bed). Hunch is
 * bent over: the whole figure tilted rigidly about its feet by `turn` radians (negative leans left);
 * never sheared or squashed, and never animated by the layer (callers swap poses or move parts).
 * Roll is the whole figure turned rigidly by `turn` radians about its middle, where it stands (a
 * caller turning it frame by frame tumbles it: see `ChunkLayer.poseEntity`). Hidden is not drawn
 * here at all, for a moment the page draws the entity itself (a rig animated part by part). Mirror
 * (Kneel) is any sprite on its knees, facing right (`turn` below 0: left): cut on a diagonal through its
 * hips, the top standing and the bottom flipped (mirrored square to the cut) to lie flat behind it as shins,
 * the two cut faces meeting in a mitre, a backwards L; a rigged sprite (ChunkLayerStyle `rig`) also hangs
 * its head (its own part) forward over what is in front of it. Every piece is rigid.
 */
/** Snapshot ticks a placed entity is drawn on in a layer after leaving its snapshots (a hand-off, before the next chunk's layer has it). */
const CARRY_TICKS = 12;

export const POSE = { Stand: 0, Lie: 1, Sit: 2, SitLeft: 3, Fallen: 4, Hunch: 5, Roll: 6, Hidden: 7, Kneel: 8 } as const;
export type PoseKind = (typeof POSE)[keyof typeof POSE];
/**
 * Which way a rigged sprite's head looks (ChunkLayerStyle `rig`), on screen: at the viewer (its standing
 * art), right, away, left. Any other way draws it in its parts, the head from its rig's view (left the
 * right one mirrored).
 */
export const LOOK = { Front: 0, Right: 1, Back: 2, Left: 3 } as const;
export type LookKind = (typeof LOOK)[keyof typeof LOOK];
export type PoseEntry = { slot: number; pose: PoseKind; turn: number; look?: LookKind };

/** At most this many ChunkLayerStyle `scales` ranges. */
export const MAX_SCALES = 4;

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
attribute float aLook;
attribute float aPiece;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform float uAlpha;
uniform float uPositionScale;
uniform vec2 uSize;
uniform float uMinPixels;
uniform vec3 uScales[${MAX_SCALES}];
uniform vec4 uRigs[${MAX_RIGS}];
uniform vec2 uRigGrid;
uniform float uRigNeck;

vec2 footOf() {
  return mix(vec2(aPrevX, aPrevY), vec2(aCurX, aCurY), uAlpha) / uPositionScale;
}
// Its sprite's height against the layer's (ChunkLayerStyle \`scales\`, [from, to) ranges, the last match wins).
float scaleOf() {
  float sprite = aSprite + 0.5;
  float scale = 1.0;
  for (int i = 0; i < ${MAX_SCALES}; i++) {
    vec3 r = uScales[i];
    if (sprite >= r.x && sprite < r.y) scale = r.z;
  }
  return scale;
}
// Its solids' salt in the heights (shadow-pass.ts sunSolidId): sprites side by side differ.
float saltOf() {
  return mod(aCurX * 7.0 + aCurY * 13.0, 254.0);
}
${KNEEL_GLSL}
bool kneeling() {
  float kind = floor(aPose.x + 0.5);
  return kind > 7.5 && kind < 8.5;
}
// Its rigged range (ChunkLayerStyle \`rig\`: [from, to, at, heads × 2 + 1 if it has its own left views], the
// last match wins); at below 0 when none.
vec4 rigOf() {
  float sprite = aSprite + 0.5;
  vec4 rig = vec4(0.0, 0.0, -1.0, 2.0);
  for (int i = 0; i < ${MAX_RIGS}; i++) {
    vec4 r = uRigs[i];
    if (sprite >= r.x && sprite < r.y) rig = r;
  }
  return rig;
}
// Which way it turns (LOOK) in its art's own frame (aLook: as posed, or the way it last walked, see
// Facings). A kneeler facing left is its art mirrored.
float lookOf() {
  float look = floor(aLook + 0.5);
  return kneeling() && aPose.y < 0.0 && mod(look, 2.0) > 0.5 ? 4.0 - look : look;
}
// Drawn from its rig's parts: a rigged sprite kneeling or turned any way but to the viewer.
bool rigged() {
  return rigOf().z > -0.5 && (kneeling() || lookOf() > 0.5);
}
// Whether its rig has views of its own looking left (asymmetric art), else its side views mirrored.
bool sidedOf() {
  return mod(floor(rigOf().w + 0.5), 2.0) > 0.5;
}
// Its rig's views per part (3, or 4 with its own left) and which it shows (LOOK order; left is right mirrored without).
float viewsOf() {
  return sidedOf() ? 4.0 : 3.0;
}
float viewOf() {
  float look = lookOf();
  return look > 2.5 && !sidedOf() ? 1.0 : look;
}
bool mirroredOf() {
  return lookOf() > 2.5 && !sidedOf();
}
// The quad's corner: the legs only kneeling, the head only rigged, the hair behind only rigged and
// looking at the viewer (else all at the feet, drawing nothing).
vec2 cornerOf() {
  if (aPiece < 0.5) return aCorner;
  if (aPiece > 2.5 ? !rigged() || lookOf() > 0.5 : aPiece > 1.5 ? !rigged() : !kneeling()) return vec2(0.0);
  return aCorner;
}
// A rig part's cell in the rig's atlas (part 0 the hair behind, 1 the body, 2 the head). A range of
// bodies × heads looks keeps, from its at: each body's views, each head's hair behind, then each head's
// views (ChunkLayerStyle \`rig\`).
float rigCellOf(float part) {
  vec4 r = rigOf();
  float heads = floor(floor(r.w + 0.5) / 2.0);
  float views = viewsOf();
  float i = floor(aSprite + 0.5 - r.x);
  float body = floor((i + 0.5) / heads);
  float head = i - body * heads;
  float bodies = floor((r.y - r.x) / heads + 0.5);
  float view = viewOf();
  if (part < 0.5) return r.z + bodies * views + head;
  if (part < 1.5) return r.z + body * views + view;
  return r.z + bodies * views + heads + head * views + view;
}
vec4 rigCellUv(float index) {
  vec2 cell = vec2(floor(mod(index + 0.5, uRigGrid.x)), floor((index + 0.5) / uRigGrid.x));
  return vec4(cell / uRigGrid, 1.0 / uRigGrid);
}
// Its piece's atlas cell (uv corner, uv size): its sprite's on \`grid\`, else its part's in the rig's atlas.
vec4 cellOf(vec2 grid) {
  if (rigged()) return rigCellUv(rigCellOf(aPiece > 2.5 ? 0.0 : aPiece > 1.5 ? 2.0 : 1.0));
  vec2 cell = vec2(floor(mod(aSprite + 0.5, grid.x)), floor((aSprite + 0.5) / grid.x));
  return vec4(cell / grid, 1.0 / grid);
}
// Where a corner of its piece reads its cell: a rig looking left reads its side views mirrored.
vec2 uvOf(vec2 corner, vec2 grid) {
  vec4 cell = cellOf(grid);
  float x = rigged() && mirroredOf() ? -corner.x : corner.x;
  return cell.xy + vec2(x + 0.5, corner.y + 1.0) * cell.zw;
}
// How far past its piece's side of the cut a corner is (see kneelCut): never, standing, nor a head.
float cutOf(vec2 corner, vec2 size) {
  return kneeling() && aPiece < 1.5 ? kneelCut(corner, size.x / size.y, aPiece) : -1.0;
}
// Which way a piece is nudged in depth: a rigged head over its body, the hair behind it under.
float depthOf() {
  return aPiece > 2.5 ? 0.000002 : aPiece > 1.5 ? -0.000002 : 0.0;
}
// A pose (see ChunkLayer.setPoses) moves the sprite's corners about its feet: lying, the quad
// turns by aPose.y about its middle, which lands on the feet (a sleeper centred on the bed);
// sitting, it is shortened onto the seat, mirrored when it faces left; fallen, it turns like a
// sleeper but nothing covers it; hunched, it tilts rigidly about its feet by aPose.y radians;
// rolling, it turns by aPose.y about its middle, which stays where it stands; hidden, it is a point;
// kneeling, it is cut in two (see KNEEL_GLSL), the bottom mirrored to lie behind, a rigged head hung
// forward about the neck, and set down onto the ground.
vec2 posedOf(vec2 corner, vec2 size) {
  vec2 p = corner * size;
  float kind = floor(aPose.x + 0.5);
  if (kind > 7.5) {
    vec2 m = vec2(0.0, -KNEEL_CUT * size.y);
    vec2 q;
    if (aPiece > 1.5) {
      q = turnAbout(turnAbout(p, vec2(0.0, -uRigNeck * size.y), KNEEL_BOW), m, KNEEL_LEAN);
    } else if (aPiece > 0.5) {
      vec2 d = p - m;
      q = m + vec2(-d.y, -d.x);
    } else {
      q = turnAbout(p, m, KNEEL_LEAN);
    }
    q.y += KNEEL_CUT * size.y - KNEEL_HALF * size.x;
    if (aPose.y < 0.0) q.x = -q.x;
    return q;
  }
  if (kind > 6.5) return vec2(0.0);
  if (kind > 5.5) {
    vec2 c = p + vec2(0.0, 0.5 * size.y);
    float s = sin(aPose.y);
    float k = cos(aPose.y);
    return vec2(k * c.x - s * c.y, s * c.x + k * c.y) - vec2(0.0, 0.5 * size.y);
  }
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
varying float vSalt;
varying vec2 vUp;
varying float vCut;
varying float vRig;

void main() {
  // A sleeper is tucked in: the bed covers it below the chest (see the fragment shader).
  vTucked = aPose.x > 0.5 && aPose.x < 1.5 ? aCorner.y + 1.0 : -1.0;
  vSalt = saltOf();
  if (aTint > ${EMPTY_SLOT - 0.5}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vUp = vec2(0.0);
    vColor = vColor2 = vColor3 = vec3(0.0);
    vCut = 1.0;
    vRig = 0.0;
    return;
  }
  vec2 foot = footOf();
  float grow = growOf();
  mat3 m = projectionMatrix * translationMatrix;
  vec2 corner = cornerOf();
  vec2 size = uSize * (grow * scaleOf());
  vCut = cutOf(corner, size);
  vec2 posed = posedOf(corner, size);
  // How far up the screen from its feet (world px), and how high that stands.
  vUp = vec2(-posed.y, -posed.y / grow);
  vec3 clip = m * vec3(foot + posed, 1.0);
  vec3 clipFoot = m * vec3(foot, 1.0);
  // Lower on screen is nearer, in every chunk alike.
  gl_Position = vec4(clip.xy, clamp(clipFoot.y * 0.5 + depthOf(), -0.999, 0.999), 1.0);
  vUv = uvOf(corner, uGrid);
  vRig = rigged() ? 1.0 : 0.0;
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
precision highp float;
varying vec2 vUv;
varying vec3 vColor;
varying vec3 vColor2;
varying vec3 vColor3;
varying float vTucked;
varying float vCut;
varying float vRig;
uniform sampler2D uAtlas;
uniform sampler2D uMask;
uniform sampler2D uRigAtlas;
uniform sampler2D uRigMask;
uniform float uMasked;
uniform float uEdges;
uniform vec3 uLight;
uniform sampler2D uLights;
uniform vec2 uLightScreen;

void main() {
  if (vTucked > ${TUCKED.toFixed(2)} || vCut > 0.0) discard;
  vec4 texel = vRig > 0.5 ? texture2D(uRigAtlas, vUv) : texture2D(uAtlas, vUv);
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
    vec4 m = vRig > 0.5 ? texture2D(uRigMask, vUv) : texture2D(uMask, vUv);
    vec3 w = clamp(m.rgb / max(m.a, 0.004), 0.0, 1.0);
    color = raw * mix(vec3(1.0), vColor, w.r) * mix(vec3(1.0), vColor2, w.g) * mix(vec3(1.0), vColor3, w.b);
  } else {
    // Opaque texels take the tint; texels drawn at about 70% alpha keep their own colour.
    float tinted = clamp((texel.a - 0.7) / 0.25, 0.0, 1.0);
    color = mix(raw, raw * vColor, tinted);
  }
  // The ambient, and the lamps and lit windows on the ground the sprite stands over (window-light.ts).
  color *= uLight + texture2D(uLights, vec2(gl_FragCoord.x, uLightScreen.y - gl_FragCoord.y) / uLightScreen).rgb;
  float alpha = uEdges > 0.5 ? texel.a : 1.0;
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

// What each texel shows the sun (shadow-pass.ts tops), drawn as the sprite is: its surface
// (ChunkLayerStyle \`surface\`) with its solid salted as in the heights, else standing upright
// over its feet, on no solid. A soft rim over half opaque is the sprite's.
const surfaceFragment = `
precision highp float;
varying vec2 vUv;
varying float vTucked;
varying float vSalt;
varying vec2 vUp;
varying float vCut;
varying float vRig;
uniform sampler2D uAtlas;
uniform sampler2D uRigAtlas;
uniform sampler2D uSurface;
uniform float uSurfaced;
${SUN_SOLID_ID}

void main() {
  if (vTucked > ${TUCKED.toFixed(2)} || vCut > 0.0 || (vRig > 0.5 ? texture2D(uRigAtlas, vUv) : texture2D(uAtlas, vUv)).a < 0.5) discard;
  if (uSurfaced > 0.5) {
    vec4 surface = floor(texture2D(uSurface, vUv) * 255.0 + 0.5);
    gl_FragColor = vec4(surface.rgb, surface.a < 254.5 ? sunSolidId(surface.a, vSalt) : 255.0) / 255.0;
    return;
  }
  // heightColor's rise: whole px in green (256 in blue's bit 4), 16ths in blue's low bits.
  float r = floor(clamp(vUp.x, 0.0, 511.0) * 16.0 + 0.5);
  gl_FragColor = vec4(min(255.0, max(0.0, vUp.y)), mod(floor(r / 16.0), 256.0), mod(r, 16.0) + 16.0 * floor(r / 4096.0), 255.0) / 255.0;
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
  vec2 corner = aPiece > 0.5 ? vec2(0.0, -0.5) : aCorner;
  vLocal = vec2(corner.x, corner.y + 0.5) * 2.0;
  mat3 m = projectionMatrix * translationMatrix;
  vec3 clip = m * vec3(foot + (vLocal * 0.5 * uShadowSize + uShadowOffset) * (grow * scaleOf()), 1.0);
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

// An upright sprite's shadow on the ground (ChunkLayerStyle `cast`): each texel `v` above where the
// sprite stands lands `v · length` toward +x, +y from there (the sun in the north-west, as the
// statics' heights cast), so the shadow starts at the feet.
const castVertex = `${instanceHeader}
uniform vec2 uGrid;
uniform float uCastLength;
uniform float uCastFeet;
varying vec2 vUv;
varying vec2 vCell;
varying float vUp;
varying float vCut;
varying float vRig;

void main() {
  if (aTint > ${EMPTY_SLOT - 0.5}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vCell = vec2(0.0);
    vUp = 0.0;
    vCut = 1.0;
    vRig = 0.0;
    return;
  }
  vec2 foot = footOf();
  float grow = growOf();
  float scale = scaleOf();
  vec2 corner = cornerOf();
  vec2 size = uSize * (grow * scale);
  vCut = cutOf(corner, size);
  vec2 p = posedOf(corner, size);
  float feet = uCastFeet * grow * scale;
  // Below the feet (the art's margin) lies nothing.
  vUp = -p.y - feet;
  float up = vUp * uCastLength;
  mat3 m = projectionMatrix * translationMatrix;
  gl_Position = vec4((m * vec3(foot + vec2(p.x + up, up - feet), 1.0)).xy, 0.0, 1.0);
  vUv = uvOf(corner, uGrid);
  vRig = rigged() ? 1.0 : 0.0;
  vCell = (vec2(floor(mod(aSprite + 0.5, uGrid.x)), floor((aSprite + 0.5) / uGrid.x)) + 0.5) / uGrid;
}
`;

const castFragment = `
precision mediump float;
varying vec2 vUv;
varying vec2 vCell;
varying float vUp;
varying float vCut;
varying float vRig;
uniform sampler2D uAtlas;
uniform sampler2D uRigAtlas;
uniform sampler2D uCasting;

void main() {
  if (vUp < 0.0 || vCut > 0.0 || texture2D(uCasting, vCell).a < 0.5 || (vRig > 0.5 ? texture2D(uRigAtlas, vUv) : texture2D(uAtlas, vUv)).a < 0.5) discard;
  gl_FragColor = vec4(1.0);
}
`;

// A prop's plan for the sun's shadows (ChunkLayerStyle `heights`): its cell of the heights atlas,
// laid flat on the ground with the sprite's feet `uLift` above the cell's bottom middle.
const heightsVertex = `${instanceHeader}
uniform vec2 uGrid;
uniform float uLift;
varying vec2 vUv;
varying float vSalt;

void main() {
  if (aTint > ${EMPTY_SLOT - 0.5}) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0);
    vSalt = 0.0;
    return;
  }
  mat3 m = projectionMatrix * translationMatrix;
  // One piece, whatever its pose.
  vec2 corner = aPiece > 0.5 ? vec2(0.0) : aCorner;
  gl_Position = vec4((m * vec3(footOf() + (corner * uSize + vec2(0.0, uLift)) * scaleOf(), 1.0)).xy, 0.0, 1.0);
  float column = floor(mod(aSprite + 0.5, uGrid.x));
  vec2 cell = vec2(column, floor((aSprite + 0.5) / uGrid.x));
  vUv = (cell + vec2(corner.x + 0.5, corner.y + 1.0)) / uGrid;
  vSalt = saltOf();
}
`;

const heightsFragment = `
precision highp float;
varying vec2 vUv;
varying float vSalt;
uniform sampler2D uHeights;
${SUN_SOLID_ID}

void main() {
  vec4 texel = texture2D(uHeights, vUv);
  if (texel.a < 0.5) discard;
  // Blue: its solid; the sprite's texels on it are never shaded by it (shadow-pass.ts).
  gl_FragColor = vec4(texel.rg / texel.a, sunSolidId(texel.b / texel.a * 255.0, vSalt) / 255.0, 1.0);
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
varying vec4 vKneel;

void main() {
  vKneel = vec4(0.0);
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
  vec2 size = uSize * (grow * scaleOf());
  // The halo keeps a minimum width on screen, so the hive still reads far out.
  float reach = max(uGlowRadius * grow, uGlowMinPixels / max(pixelsPerUnit, 0.0001)) * shape.y * (1.0 + 0.35 * throb);
  vec2 margin = vec2(reach) / size;
  mat3 m = projectionMatrix * translationMatrix;
  if (kneeling() || rigged()) {
    // A kneeler's or a rig's halo is one, round all its pieces as posed (see glowFragment): on the first
    // piece, a quad its height (and the reach) about its feet each way, in its art's frame in vUv (posed px
    // over its height); its body's cell; how it is drawn (x: 1 kneeling, 2 rigged, 3 both, 4 more mirrored),
    // its head's rig cell (y) and its hair behind's (z, below 0 when not drawn).
    if (aPiece > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      vUv = vReach = vec2(0.0);
      vCell = vGlow = vec4(0.0);
      return;
    }
    vec2 local = vec2(aCorner.x * 2.0, aCorner.y) * (size.y + 2.0 * reach) + vec2(0.0, reach);
    vec3 clipAt = m * vec3(foot + vec2(kneeling() && aPose.y < 0.0 ? -local.x : local.x, local.y), 1.0);
    vec3 clipFeet = m * vec3(foot, 1.0);
    gl_Position = vec4(clipAt.xy, clamp(clipFeet.y * 0.5, -0.999, 0.999), 1.0);
    vUv = local / size.y;
    vReach = vec2(reach / size.y, size.x / size.y);
    bool rig = rigged();
    vKneel = vec4(
      (kneeling() ? 1.0 : 0.0) + (rig ? 2.0 : 0.0) + (rig && mirroredOf() ? 4.0 : 0.0),
      rig ? rigCellOf(2.0) : 0.0,
      rig && lookOf() < 0.5 ? rigCellOf(0.0) : -1.0,
      0.0);
    vCell = cellOf(uGrid);
    return;
  }
  vec2 corner = aPiece > 0.5 ? vec2(0.0) : aCorner * (1.0 + 2.0 * margin) + vec2(0.0, -margin.y);
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
varying vec4 vKneel;
uniform sampler2D uAtlas;
uniform sampler2D uRigAtlas;
uniform highp float uRigNeck;
uniform highp vec2 uRigGrid;
${KNEEL_GLSL}

float coverage(vec2 uv) {
  if (uv.x < vCell.x || uv.y < vCell.y || uv.x > vCell.z || uv.y > vCell.w) return 0.0;
  return texture2D(uAtlas, uv).a;
}

// A rig part's cell (uv corner, uv size) by its index in the rig's atlas.
vec4 rigCell(float index) {
  vec2 cell = vec2(floor(mod(index + 0.5, uRigGrid.x)), floor((index + 0.5) / uRigGrid.x));
  return vec4(cell / uRigGrid, 1.0 / uRigGrid);
}

// A kneeler's piece's coverage at corner c (quad corner units) of its cell (uv corner, uv size), from its
// rig's atlas or the atlas.
float partCoverage(vec2 c, vec4 cell, bool rig) {
  if (c.x < -0.5 || c.x > 0.5 || c.y < -1.0 || c.y > 0.0) return 0.0;
  vec2 uv = cell.xy + (c + vec2(0.5, 1.0)) * cell.zw;
  return rig ? texture2D(uRigAtlas, uv).a : texture2D(uAtlas, uv).a;
}

// A kneeler's or a rig's coverage at l (posed px over its height, in its art's frame): each piece's, its
// pose undone (posedOf), a kneeler's body within its side of the cut.
float kneelCoverage(vec2 l) {
  float aspect = vReach.y;
  bool kneel = mod(vKneel.x, 2.0) > 0.5;
  bool rig = mod(vKneel.x, 4.0) > 1.5;
  float flip = vKneel.x > 3.5 ? -1.0 : 1.0;
  vec2 toCorner = vec2(1.0 / aspect, 1.0);
  vec2 q = kneel ? l - vec2(0.0, KNEEL_CUT - KNEEL_HALF * aspect) : l;
  vec2 m = vec2(0.0, -KNEEL_CUT);
  // The top's pose undone: its lean (kneeling).
  vec2 top = kneel ? turnAbout(q, m, -KNEEL_LEAN) : q;
  vec2 c = top * toCorner;
  float a = kneel && kneelCut(c, aspect, 0.0) > 0.0 ? 0.0 : partCoverage(vec2(flip * c.x, c.y), vCell, rig);
  if (kneel) {
    vec2 d = q - m;
    c = (m + vec2(-d.y, -d.x)) * toCorner;
    if (kneelCut(c, aspect, 1.0) <= 0.0) a = max(a, partCoverage(c, vCell, rig));
  }
  if (rig) {
    c = turnAbout(top, vec2(0.0, -uRigNeck), kneel ? -KNEEL_BOW : 0.0) * toCorner;
    a = max(a, partCoverage(vec2(flip * c.x, c.y), rigCell(vKneel.y), true));
    if (vKneel.z > -0.5) a = max(a, partCoverage(c, rigCell(vKneel.z), true));
  }
  return a;
}

float sampled(vec2 at) {
  return vKneel.x > 0.5 ? kneelCoverage(at) : coverage(at);
}

void main() {
  // A dilated, softened silhouette: coverage sampled on two rings around the pixel.
  float a = sampled(vUv);
  float ring = 0.0;
  float near = 0.0;
  vec2 reach = vKneel.x > 0.5 ? vec2(vReach.x) : vReach;
  for (int i = 0; i < 10; i++) {
    float t = float(i) * 0.6283;
    vec2 d = vec2(cos(t), sin(t));
    ring += sampled(vUv + d * reach);
    near += sampled(vUv + d * reach * 0.45);
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
   * The sun's shadows of upright sprites (a tree, a lamp post), with the statics' (ChunkScene
   * `castShadow`, shadow-pass.ts): each of `sprites` lays its silhouette on the ground toward the
   * south-east, `length` (default 1) world units per unit it stands above its feet, which are
   * `feet` (default 0) world units above the sprite's bottom edge.
   */
  cast?: { sprites: readonly number[]; length?: number; feet?: number };
  /**
   * Each sprite seen from straight above for the sun's shadows (shadow-pass.ts heights): an atlas on
   * the same grid, each cell `size` world units with the sprite's feet at its bottom middle (or
   * `heightsLift` above it), every shape filled with `solidColor(top, base)`; an empty cell stands
   * nothing up.
   */
  heights?: PIXI.Texture;
  /**
   * How far up its cell (world units) the heights atlas puts the feet, leaving room below them for
   * what reaches out in front of the footprint (a street light's arm); default 0.
   */
  heightsLift?: number;
  /**
   * Each texel's surface for the sun's shadows on the sprite itself (shadow-pass.ts `paintSurface`,
   * from `heights`): an atlas on the same grid as `atlas`, each opaque texel's height and rise.
   */
  surface?: PIXI.Texture;
  /**
   * Soft glowing halos around the silhouettes of some sprites (e.g. one sprite set), drawn under
   * every sprite and unaffected by `setLight`. At most MAX_GLOWS (6) ranges (see GlowRange: one colour or a
   * ramp picked by sprite offset or tint, an optional pulse and a wider ring). `radius` is in
   * world units; the halo is never thinner than `minPixels` on screen.
   */
  glow?: { radius: number; minPixels?: number; ranges: GlowRange[] };
  /**
   * Sprites drawn taller than `size` (e.g. one set of big creatures among people): each [from, to)
   * range's quad, drop shadow, cast shadow and glow are `scale` times the layer's, about its feet,
   * and its atlas cell is stretched to fit (so draw that art filling its cell). At most
   * MAX_SCALES ranges; the last match wins. The minimum on-screen size still goes by `size`.
   */
  scales?: readonly SpriteScale[];
  /**
   * Sprites drawn as rigs of rigid parts when a pose moves their parts apart (POSE.Kneel: the head
   * hung forward over the body) or they turn from the viewer (LOOK, or the way they walk: `follow`, how
   * far in world px a standing sprite goes before it turns that way, holding it while it stands: Facings,
   * and `place`d ones by the page's moves). An atlas (and
   * tint mask, with `mask`) on `grid` of parts, each a cell the atlas's size where it sits in the standing
   * sprite's. Each of `ranges` (at most MAX_RIGS) is `bodies` × `heads` looks (sprite `from + body × heads
   * + head`), its parts from cell `at` on: each body's (headless) views, each head's hair behind (drawn
   * looking at the viewer), then each head's views. The views are at the viewer, looking right (side on)
   * and away, plus looking left with `sided` (asymmetric art; else left is right mirrored). `neck` is
   * where the head turns, of the sprite's height above its feet.
   */
  rig?: { atlas: PIXI.Texture; mask?: PIXI.Texture; grid: [number, number]; neck: number; follow?: number; ranges: readonly RigRange[] };
};

/** One range of sprites drawn as rigs (ChunkLayerStyle `rig`): `heads` looks per body, its parts from cell `at`; `sided`, its own left views. */
export type RigRange = { from: number; to: number; at: number; heads: number; sided?: boolean };

/** A rig range's cells in the rig's atlas (see ChunkLayerStyle `rig`). */
export const rigCells = ({ from, to, heads, sided }: RigRange) => {
  const views = sided ? 4 : 3;
  return ((to - from) / heads) * views + heads * (1 + views);
};

/** `rig` as the shaders' uniforms: its ranges ([from, to, at, heads × 2 + sided] each, unused slots matching nothing), grid and neck. */
export function rigUniforms(rig?: ChunkLayerStyle["rig"]) {
  const ranges = rig?.ranges ?? [];
  if (ranges.length > MAX_RIGS) throw new Error(`ChunkLayerStyle.rig: at most ${MAX_RIGS} ranges, got ${ranges.length}`);
  const uRigs = new Float32Array(MAX_RIGS * 4);
  ranges.forEach((r, i) => uRigs.set([r.from, r.to, r.at, r.heads * 2 + (r.sided ? 1 : 0)], i * 4));
  return { uRigs, uRigGrid: new Float32Array(rig?.grid ?? [1, 1]), uRigNeck: rig?.neck ?? 0 };
}

/** One range of sprites drawn `scale` times the layer's size (ChunkLayerStyle `scales`). */
export type SpriteScale = { from: number; to: number; scale: number };


/** `scales` as the shaders' uScales: [from, to, scale] each, unused slots matching nothing. */
export function scaleUniforms(scales: readonly SpriteScale[] = []) {
  if (scales.length > MAX_SCALES) throw new Error(`ChunkLayerStyle.scales: at most ${MAX_SCALES} ranges, got ${scales.length}`);
  const out = new Float32Array(MAX_SCALES * 3);
  scales.forEach((r, i) => out.set([r.from, r.to, r.scale], i * 3));
  return out;
}

/** One style's GPU programs and shared uniforms. */
class LayerKind {
  readonly program: PIXI.Program;
  readonly surfaceProgram: PIXI.Program;
  readonly shared: PIXI.UniformGroup;
  readonly shadowProgram: PIXI.Program | null;
  readonly shadowShared: PIXI.UniformGroup | null;
  readonly glowProgram: PIXI.Program | null = null;
  readonly glowShared: PIXI.UniformGroup | null = null;
  readonly castProgram: PIXI.Program | null = null;
  readonly heightsProgram: PIXI.Program | null = null;
  /** Which sprites cast (`style.cast`), one texel per atlas cell. */
  readonly casting: PIXI.Texture | null = null;
  readonly style: ChunkLayerStyle;
  /** Which way each entity faces, kept between frames (`rig.follow`), for every layer of this kind. */
  readonly facings: Facings | null;

  constructor(style: ChunkLayerStyle) {
    this.style = style;
    this.facings = style.rig?.follow ? new Facings(style.rig.follow) : null;
    for (const texture of [style.atlas, style.mask, style.rig?.atlas, style.rig?.mask]) {
      if (!texture) continue;
      texture.baseTexture.scaleMode = style.smooth ? PIXI.SCALE_MODES.LINEAR : PIXI.SCALE_MODES.NEAREST;
      texture.baseTexture.mipmap = style.smooth ? PIXI.MIPMAP_MODES.ON : PIXI.MIPMAP_MODES.OFF;
    }
    const scales = scaleUniforms(style.scales);
    const rig = rigUniforms(style.rig);
    this.program = PIXI.Program.from(vertex, fragment, "yage-chunk-layer");
    this.surfaceProgram = PIXI.Program.from(vertex, surfaceFragment, "yage-chunk-surface");
    this.shared = new PIXI.UniformGroup({
      uPositionScale: POSITION_SCALE,
      uSize: new Float32Array(style.size),
      uMinPixels: style.minPixels ?? 2,
      uScales: scales,
      uGrid: new Float32Array(style.grid),
      uPalette: paletteArray(style.palette),
      uFields: new Float32Array(style.mask && style.fields ? style.fields : [0, 0, 0]),
      uMasked: style.mask ? 1 : 0,
      uLight: new Float32Array([1, 1, 1]),
      uTime: 0,
      ...rig,
    });
    if (style.shadow) {
      this.shadowProgram = PIXI.Program.from(shadowVertex, shadowFragment, "yage-chunk-shadow");
      const alpha = style.shadow.alpha ?? 0.3;
      this.shadowShared = new PIXI.UniformGroup({
        uPositionScale: POSITION_SCALE,
        uSize: new Float32Array(style.size),
        uMinPixels: style.minPixels ?? 2,
        uScales: scales,
        uShadowSize: new Float32Array(style.shadow.size),
        uShadowOffset: new Float32Array(style.shadow.offset ?? [0, 0]),
        uShadowAlpha: alpha,
        uTime: 0,
      });
    } else {
      this.shadowProgram = null;
      this.shadowShared = null;
    }
    if (style.cast) {
      const [columns, rows] = style.grid;
      const cells = new Uint8Array(columns * rows * 4);
      for (const sprite of style.cast.sprites) if (sprite >= 0 && sprite < columns * rows) cells.fill(255, sprite * 4, sprite * 4 + 4);
      this.casting = PIXI.Texture.fromBuffer(cells, columns, rows, { scaleMode: PIXI.SCALE_MODES.NEAREST, mipmap: PIXI.MIPMAP_MODES.OFF });
      this.castProgram = PIXI.Program.from(castVertex, castFragment, "yage-chunk-cast");
    }
    if (style.heights) {
      // Exact heights: never blended between texels.
      style.heights.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      style.heights.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
      this.heightsProgram = PIXI.Program.from(heightsVertex, heightsFragment, "yage-chunk-heights");
    }
    if (style.surface) {
      style.surface.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
      style.surface.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
    }
    if (style.glow) {
      const glow = glowUniforms(style.glow.ranges);
      this.glowProgram = PIXI.Program.from(glowVertex, glowFragment, "yage-chunk-glow");
      this.glowShared = new PIXI.UniformGroup({
        uPositionScale: POSITION_SCALE,
        uSize: new Float32Array(style.size),
        uMinPixels: style.minPixels ?? 2,
        uScales: scales,
        uGrid: new Float32Array(style.grid),
        uGlowBounds: glow.bounds,
        uGlowShape: glow.shape,
        uGlowRamp: glow.ramp,
        uGlowTime: 0,
        uTime: 0,
        uGlowRadius: style.glow.radius,
        uGlowMinPixels: style.glow.minPixels ?? 2,
        ...rig,
      });
    }
  }

  shader(edges: boolean) {
    return new PIXI.Shader(this.program, {
      uAtlas: this.style.atlas,
      uMask: this.style.mask ?? this.style.atlas,
      uRigAtlas: this.style.rig?.atlas ?? this.style.atlas,
      uRigMask: this.style.rig?.mask ?? this.style.rig?.atlas ?? this.style.atlas,
      uAlpha: 1,
      uEdges: edges ? 1 : 0,
      shared: this.shared,
      lights: lightUniforms(),
    });
  }

  /** Its sprites' surfaces for the shadow pass (`surfaceFragment`). */
  surfaceShader() {
    return new PIXI.Shader(this.surfaceProgram, {
      uAtlas: this.style.atlas,
      uRigAtlas: this.style.rig?.atlas ?? this.style.atlas,
      uAlpha: 1,
      uSurface: this.style.surface ?? this.style.atlas,
      uSurfaced: this.style.surface ? 1 : 0,
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
  /** The sun's shadows of upright sprites, for ChunkScene's shadow pass; null when the style has none (`cast`). */
  readonly cast: PIXI.Mesh<PIXI.Shader> | null;
  /** The sprites' plans at their heights, for ChunkScene's shadow pass; null when the style has none (`heights`). */
  readonly heights: PIXI.Mesh<PIXI.Shader> | null;
  /** What the sprites' texels show the sun, for ChunkScene's shadow pass, depth-tested as they are. */
  readonly surface: PIXI.Mesh<PIXI.Shader>;
  private readonly prevX: PIXI.Buffer;
  private readonly prevY: PIXI.Buffer;
  private readonly curX: PIXI.Buffer;
  private readonly curY: PIXI.Buffer;
  private readonly sprite: PIXI.Buffer;
  private readonly tintBuffer: PIXI.Buffer;
  private readonly poseBuffer: PIXI.Buffer;
  private readonly lookBuffer: PIXI.Buffer;
  private poseData = new Float32Array(2);
  /** Which way each instance's head looks (LOOK). */
  private lookData = new Uint8Array(1);
  private poses: readonly PoseEntry[] = [];
  /** Poses sent ahead of the drawn snapshot, applied as their tick is reached (oldest first). */
  private posesAhead: { tick: number; poses: readonly PoseEntry[] }[] = [];
  /** The pair's version last written to the buffers. */
  private written = -1;
  private extent: number;
  /** The entity drawn where the page puts it (`place`), not between its snapshots; -1 none. */
  private placedGid = -1;
  /** Which way each entity faces (the kind's, shared across chunks), or null without a rig's follow. */
  private readonly facings: Facings | null;
  /** The entity posed by gid (`poseEntity`), and its pose. */
  private posedGid = -1;
  private posedPose: PoseKind = POSE.Stand;
  private posedTurn = 0;
  private posedLook: LookKind = LOOK.Front;
  /** Entities held in a pose by gid (`holdPose`), any number at once. */
  private held = new Map<number, { pose: PoseKind; turn: number; look: LookKind }>();
  private placedX = 0;
  private placedY = 0;
  /** False: the placed entity is drawn by another layer (its copy here is hidden). */
  private placedShown = true;
  /** The placed entity's look in the last snapshot here that had it, and that snapshot's tick: drawn on for a few ticks after it leaves (a hand-off's gap). */
  private carrySprite = 0;
  private carryTint = 0;
  private carryTick = -Infinity;
  private placeX = new Int16Array(0);
  private placeY = new Int16Array(0);
  private placeSprite = new Uint16Array(0);
  private placeTint = new Uint8Array(0);

  constructor(kind: LayerKind, extent: number, expectedInterval: number, tickInterval = expectedInterval) {
    // Each layer has its own shader objects (one program, shared uniform group) for its own alpha.
    // The quad four times: a kneeler's pieces (see KNEEL_GLSL), drawn hair behind, legs, body, head;
    // all but the first only kneeling.
    const quad = [-0.5, -1, 0.5, -1, 0.5, 0, -0.5, 0];
    const corners = new PIXI.Buffer(new Float32Array([...quad, ...quad, ...quad, ...quad]), true);
    const pieces = new PIXI.Buffer(new Float32Array([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3]), true);
    const empty16 = () => new PIXI.Buffer(new Int16Array(1), false);
    const empty8 = () => new PIXI.Buffer(new Uint8Array(1), false);
    const prevX = empty16();
    const prevY = empty16();
    const curX = empty16();
    const curY = empty16();
    const sprite = new PIXI.Buffer(new Uint16Array(1), false);
    const tint = empty8();
    const pose = new PIXI.Buffer(new Float32Array(2), false);
    const look = empty8();
    const geometry = new PIXI.Geometry()
      .addAttribute("aCorner", corners, 2, false, GL_FLOAT as PIXI.TYPES)
      .addAttribute("aPiece", pieces, 1, false, GL_FLOAT as PIXI.TYPES)
      .addAttribute("aPrevX", prevX, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aPrevY", prevY, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aCurX", curX, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aCurY", curY, 1, false, GL_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aSprite", sprite, 1, false, GL_UNSIGNED_SHORT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aTint", tint, 1, false, GL_UNSIGNED_BYTE as PIXI.TYPES, 0, 0, true)
      .addAttribute("aPose", pose, 2, false, GL_FLOAT as PIXI.TYPES, 0, 0, true)
      .addAttribute("aLook", look, 1, false, GL_UNSIGNED_BYTE as PIXI.TYPES, 0, 0, true)
      .addIndex(new Uint16Array([12, 13, 14, 12, 14, 15, 4, 5, 6, 4, 6, 7, 0, 1, 2, 0, 2, 3, 8, 9, 10, 8, 10, 11]));
    geometry.instanceCount = 0;
    const state = PIXI.State.for2d();
    state.depthTest = true;
    state.depthMask = true;
    state.blend = false;
    super(geometry, kind.shader(false), state);
    this.facings = kind.facings;
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
      this.glow = new PIXI.Mesh(geometry, new PIXI.Shader(kind.glowProgram, { uAlpha: 1, uAtlas: kind.style.atlas, uRigAtlas: kind.style.rig?.atlas ?? kind.style.atlas, shared }), glowState);
    } else {
      this.glow = null;
    }
    if (kind.castProgram && kind.casting && kind.style.cast) {
      const castState = PIXI.State.for2d();
      castState.depthTest = false;
      castState.depthMask = false;
      castState.blend = false;
      const uniforms = { uAlpha: 1, uAtlas: kind.style.atlas, uRigAtlas: kind.style.rig?.atlas ?? kind.style.atlas, uCasting: kind.casting, uCastLength: kind.style.cast.length ?? 1, uCastFeet: kind.style.cast.feet ?? 0, shared: kind.shared };
      this.cast = new PIXI.Mesh(geometry, new PIXI.Shader(kind.castProgram, uniforms), castState);
    } else {
      this.cast = null;
    }
    const surfaceState = PIXI.State.for2d();
    surfaceState.depthTest = true;
    surfaceState.depthMask = true;
    surfaceState.blend = false;
    this.surface = new PIXI.Mesh(geometry, kind.surfaceShader(), surfaceState);
    if (kind.heightsProgram && kind.style.heights) {
      const heightsState = PIXI.State.for2d();
      heightsState.depthTest = false;
      heightsState.depthMask = false;
      heightsState.blend = false;
      this.heights = new PIXI.Mesh(geometry, new PIXI.Shader(kind.heightsProgram, { uAlpha: 1, uHeights: kind.style.heights, uLift: kind.style.heightsLift ?? 0, shared: kind.shared }), heightsState);
    } else {
      this.heights = null;
    }
    this.prevX = prevX;
    this.prevY = prevY;
    this.curX = curX;
    this.curY = curY;
    this.sprite = sprite;
    this.tintBuffer = tint;
    this.poseBuffer = pose;
    this.lookBuffer = look;
    this.extent = extent;
    this.pair = new SnapshotPair(expectedInterval, tickInterval);
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
    if (this.cast) meshes.push(this.cast);
    if (this.heights) meshes.push(this.heights);
    meshes.push(this.surface);
    return meshes;
  }

  setPosition(x: number, y: number) {
    for (const mesh of this.companions()) mesh.position.set(x, y);
  }

  setVisible(visible: boolean) {
    for (const mesh of this.companions()) mesh.visible = visible;
  }

  /** Queues a snapshot for the pair's playout (the first, or a stale one, shows at once). */
  push(snapshot: Snapshot, now: number) {
    this.pair.push(snapshot, now);
    if (this.write()) this.setVisible(this.drawnCount > 0);
  }

  /** Entities in the drawn snapshot. */
  get count() {
    return this.pair.current?.count ?? 0;
  }

  /** Instances drawn: the snapshot's, and a placed entity carried past it (`place`). */
  get drawnCount() {
    return this.geometry.instanceCount;
  }

  /** Writes the pair's current snapshot to the buffers if it changed; true if it did. */
  private write() {
    if (this.pair.version === this.written) return false;
    this.written = this.pair.version;
    const snapshot = this.pair.current!;
    let ahead = 0;
    while (ahead < this.posesAhead.length && this.posesAhead[ahead].tick <= snapshot.tick) this.poses = this.posesAhead[ahead++].poses;
    if (ahead) this.posesAhead.splice(0, ahead);
    this.follow();
    this.writePlaced();
    this.writePoses();
    return true;
  }

  /** Turns every entity in the new snapshot the way it has walked (Facings), but the placed one: `place` turns it. */
  private follow() {
    const facings = this.facings;
    const snapshot = this.pair.current;
    if (!facings || !snapshot) return;
    const { x: ox, y: oy } = this.position;
    for (let i = 0; i < snapshot.count; i++) {
      const gid = snapshot.gid[i];
      if (snapshot.tint[i] === EMPTY_SLOT || gid === this.placedGid) continue;
      facings.move(gid, ox + snapshot.x[i] / POSITION_SCALE, oy + snapshot.y[i] / POSITION_SCALE);
    }
    facings.wrote();
  }

  /**
   * Poses some slots (lying turned by `turn` radians, clockwise on screen, from upright; sitting);
   * every other slot stands. Kept across snapshots until the next call, so a slot keeps its pose
   * while the snapshots that move it arrive between pose updates. Given the tick they were taken
   * on, they wait for the drawn snapshot to reach it, so a pose turns with the snapshot it goes with.
   */
  setPoses(poses: readonly PoseEntry[], tick?: number) {
    const drawn = this.pair.current?.tick;
    if (tick !== undefined && drawn !== undefined && tick > drawn) {
      while (this.posesAhead.length && this.posesAhead[this.posesAhead.length - 1].tick >= tick) this.posesAhead.pop();
      this.posesAhead.push({ tick, poses });
      return;
    }
    this.posesAhead.length = 0;
    this.poses = poses;
    this.writePoses();
  }

  /**
   * Poses entity `gid` (over any slot pose it has), its head looking `look`, until the next call, found
   * again by gid in each snapshot (and as the placed entity carried past them); a gid of -1 lets it go.
   * For what the page animates itself on one entity, frame by frame (a roll's turn): presentation only.
   */
  poseEntity(gid: number, pose: PoseKind = POSE.Stand, turn = 0, look: LookKind = LOOK.Front) {
    if (gid < 0 && this.posedGid < 0) return;
    this.posedGid = gid;
    this.posedPose = pose;
    this.posedTurn = turn;
    this.posedLook = look;
    if (this.pair.current) this.writePoses();
  }

  /**
   * Holds entity `gid` in a pose (over any slot pose it has) until `releasePose`, found again by gid
   * in each snapshot like `poseEntity`, for any number of entities at once (a crowd each swinging on
   * its own beat). Presentation only. `poseEntity`'s one entity wins where both name the same gid.
   */
  holdPose(gid: number, pose: PoseKind, turn = 0, look: LookKind = LOOK.Front) {
    this.held.set(gid, { pose, turn, look });
    if (this.pair.current) this.writePoses();
  }

  /** Lets an entity `holdPose` held go. */
  releasePose(gid: number) {
    if (this.held.delete(gid) && this.pair.current) this.writePoses();
  }

  /** Which way each instance faces (LOOK): as its head looks when posed, else the way it last walked. */
  get lookArray(): Uint8Array {
    return this.lookData.subarray(0, this.geometry.instanceCount);
  }

  /** The pose data per instance (mode, turn), for tests. */
  get poseArray(): Float32Array {
    return this.poseData.subarray(0, this.geometry.instanceCount * 2);
  }

  private writePoses() {
    const count = Math.max(1, this.geometry.instanceCount);
    if (this.poseData.length < count * 2) this.poseData = new Float32Array(count * 2);
    else this.poseData.fill(0);
    if (this.lookData.length < count) this.lookData = new Uint8Array(count);
    else this.lookData.fill(0);
    // Standing, each faces the way it last walked; a pose below says otherwise.
    const current = this.pair.current;
    if (this.facings && current) {
      const n = Math.min(count, current.count);
      for (let i = 0; i < n; i++) this.lookData[i] = this.facings.look(current.gid[i]);
      if (this.placedGid >= 0 && count > current.count) this.lookData[current.count] = this.facings.look(this.placedGid);
    }
    for (const p of this.poses) {
      if (p.slot >= count) continue;
      this.poseData[p.slot * 2] = p.pose;
      this.poseData[p.slot * 2 + 1] = p.turn;
      this.lookData[p.slot] = p.look ?? LOOK.Front;
    }
    const snapshot = this.pair.current;
    if (this.held.size && snapshot) {
      const gids = snapshot.gid.subarray(0, snapshot.count);
      for (const [gid, held] of this.held) {
        const slot = gids.indexOf(gid);
        if (slot < 0 || slot >= count) continue;
        this.poseData[slot * 2] = held.pose;
        this.poseData[slot * 2 + 1] = held.turn;
        this.lookData[slot] = held.look;
      }
    }
    if (this.posedGid >= 0 && snapshot) {
      let slot = snapshot.gid.subarray(0, snapshot.count).indexOf(this.posedGid);
      if (slot < 0 && this.posedGid === this.placedGid && this.geometry.instanceCount > snapshot.count) slot = snapshot.count;
      if (slot >= 0 && slot < count) {
        this.poseData[slot * 2] = this.posedPose;
        this.poseData[slot * 2 + 1] = this.posedTurn;
        this.lookData[slot] = this.posedLook;
      }
    }
    this.poseBuffer.update(this.poseData.subarray(0, count * 2));
    this.lookBuffer.update(this.lookData.subarray(0, count));
  }

  /**
   * Draws entity `gid` at chunk-local (x, y) (world units from the chunk's corner) instead of
   * between its snapshots, until the next call; a gid of -1 lets it go. For what the page knows
   * ahead of the stream (the entity it steers, moved on its keys every frame): presentation only,
   * the snapshots themselves are untouched. Kept across snapshots, found again by gid in each; gone
   * from one (handed to the next chunk, not there yet) it is drawn on as last seen for CARRY_TICKS.
   * `shown` false hides it here instead (another layer draws it: `ChunkScene.place`).
   */
  place(gid: number, x = 0, y = 0, shown = true) {
    if (gid < 0 && this.placedGid < 0) return;
    if (gid !== this.placedGid) this.carryTick = -Infinity;
    this.placedGid = gid;
    this.placedShown = shown;
    this.placedX = Math.round(x * POSITION_SCALE);
    this.placedY = Math.round(y * POSITION_SCALE);
    // Steered between snapshots: it turns the way the page walks it.
    if (gid >= 0 && shown) this.facings?.move(gid, this.position.x + x, this.position.y + y);
    if (this.pair.current) {
      this.writePlaced();
      this.writePoses();
    }
  }

  /** The current snapshot's instances, the placed entity's slot (or its carried one past them) at its placed spot. */
  private writePlaced() {
    const snapshot = this.pair.current!;
    const count = snapshot.count;
    const slot = this.placedGid < 0 ? -1 : snapshot.gid.subarray(0, count).indexOf(this.placedGid);
    if (slot >= 0 && snapshot.tint[slot] !== EMPTY_SLOT) {
      this.carrySprite = snapshot.sprite[slot];
      this.carryTint = snapshot.tint[slot];
      this.carryTick = snapshot.tick;
    }
    const carried = slot < 0 && this.placedGid >= 0 && this.placedShown && snapshot.tick - this.carryTick <= CARRY_TICKS;
    if (slot < 0 && !carried) {
      this.prevX.update(this.pair.prevX.subarray(0, count));
      this.prevY.update(this.pair.prevY.subarray(0, count));
      this.curX.update(snapshot.x);
      this.curY.update(snapshot.y);
      this.sprite.update(snapshot.sprite);
      this.tintBuffer.update(snapshot.tint);
      this.geometry.instanceCount = count;
      return;
    }
    const n = count + (carried ? 1 : 0);
    if (this.placeX.length < n * 2) {
      this.placeX = new Int16Array(n * 3);
      this.placeY = new Int16Array(n * 3);
      this.placeSprite = new Uint16Array(n * 2);
      this.placeTint = new Uint8Array(n * 2);
    }
    const x = Math.max(-32768, Math.min(32767, this.placedX));
    const y = Math.max(-32768, Math.min(32767, this.placedY));
    const prevX = this.placeX.subarray(0, n), curX = this.placeX.subarray(n, n * 2);
    const prevY = this.placeY.subarray(0, n), curY = this.placeY.subarray(n, n * 2);
    const sprite = this.placeSprite.subarray(0, n), tint = this.placeTint.subarray(0, n);
    prevX.set(this.pair.prevX.subarray(0, count));
    prevY.set(this.pair.prevY.subarray(0, count));
    curX.set(snapshot.x.subarray(0, count));
    curY.set(snapshot.y.subarray(0, count));
    sprite.set(snapshot.sprite.subarray(0, count));
    tint.set(snapshot.tint.subarray(0, count));
    const at = carried ? count : slot;
    if (carried) {
      sprite[at] = this.carrySprite;
      tint[at] = this.carryTint;
    }
    if (this.placedShown) {
      prevX[at] = curX[at] = x;
      prevY[at] = curY[at] = y;
    } else tint[at] = EMPTY_SLOT;
    this.prevX.update(prevX);
    this.prevY.update(prevY);
    this.curX.update(curX);
    this.curY.update(curY);
    this.sprite.update(sprite);
    this.tintBuffer.update(tint);
    this.geometry.instanceCount = n;
  }

  /** Plays the snapshots out to `now` and sets the interpolation point between the drawn two. */
  interpolate(now: number) {
    this.pair.advance(now);
    this.write();
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
    this.cast?.destroy();
    this.heights?.destroy();
    this.surface.destroy();
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
  /** Milliseconds per sim tick, the rate snapshots are played out at (default `snapshotInterval`). */
  tickInterval?: number;
  /**
   * Depth-sorted roofs: static instances' over parts draw before the sprites, each hiding the
   * sprites behind its near edge by depth (see statics.ts), so people in front of a building draw
   * over its roof and people inside stay under it. Drop shadows and glows are depth-tested too.
   */
  roofDepth?: boolean;
  /**
   * Half the widest sprite's width (world units), for `roofDepth`: a sprite draws at its feet's one
   * depth, so a building's near edge holds back that far either side of them, and someone at the foot
   * of a wall turned down the screen isn't cut through where the wall's edge passes the depth of their feet.
   */
  roofReach?: number;
  /**
   * When static instances build their parts: "listed" (default) as soon as a chunk lists them,
   * "seen" the first time one is in view, so a streamed-in ring of chunks costs nothing until the
   * camera reaches it.
   */
  buildStatics?: "listed" | "seen";
  /** With `buildStatics: "seen"`, milliseconds an update may spend building them (nearest first); default unbounded. */
  staticBudget?: number;
  /** With `staticBudget`, milliseconds an update always gets for them, whatever the frame's shared budget has left. */
  staticFloor?: number;
  /** Zoomed far out, each chunk's static instances drawn as one picture (far.ts); `update` then needs its `far` argument. */
  farBake?: FarBakeOptions;
  /** How dark the sun's shadows from static instances (`StaticParts.heights`) lie, 0–1 at full light (default 0.2); scaled by `setLight`'s sun. */
  castShadow?: number;
};

type ChunkView = {
  cx: number;
  cy: number;
  ground: PIXI.Container;
  /** Over the ground, under every sprite; see `setDecals`. */
  decals: PIXI.Container | null;
  /** The chunk's far picture under its ground and over its decals; see `setFar`. */
  farUnder: PIXI.Container | null;
  farOver: PIXI.Container | null;
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
  /** The screen's light (window-light.ts), drawn first so the ground and decals can sample it. */
  readonly lightPass = new LightPass();
  readonly groundRoot = new PIXI.Container();
  /** Per-chunk far pictures' grounds, under every chunk's ground; see `setFar`. */
  readonly farUnderRoot = new PIXI.Container();
  /** Per-chunk decals (road meshes…), over every chunk's ground. */
  readonly decalRoot = new PIXI.Container();
  /** Per-chunk far pictures' tops, over the decals and under the static instances; see `setFar`. */
  readonly farOverRoot = new PIXI.Container();
  /** The sun's shadows, one deferred pass over everything the scene draws, last (shadow-pass.ts). */
  readonly castRoot: ShadowPass;
  /** Static instances' lower parts (floors, walls), under every sprite and its shadow. */
  readonly staticRoot = new PIXI.Container();
  readonly shadowRoot = new PIXI.Container();
  readonly entityRoot = new PIXI.Container();
  readonly edgeRoot = new PIXI.Container();
  /** Static instances' upper parts (roofs), over every sprite. */
  readonly overRoot = new PIXI.Container();
  /** Static instances placed at any position and angle; see `setStatics`. */
  readonly statics: StaticSet;
  /** Their far-off chunks' pictures, with `farBake` (else null), where the static instances stack. */
  readonly far: FarBake | null;
  readonly views = new Map<number, ChunkView>();
  /** What `place` draws, and the chunk whose layer draws it (-1 none). */
  private placedGid = -1;
  private placedKey = -1;
  private readonly entities: LayerKind;
  private readonly propKinds: LayerKind[];
  private readonly options: ChunkSceneOptions;

  constructor(options: ChunkSceneOptions) {
    this.options = options;
    this.castRoot = new ShadowPass(!!options.roofDepth);
    this.statics = new StaticSet(this.staticRoot, this.overRoot, !!options.roofDepth, options.buildStatics === "seen", options.staticBudget, options.staticFloor, this.castRoot, options.roofReach ?? 0);
    this.castRoot.darkness = options.castShadow ?? 0.2;
    this.entities = new LayerKind(options.style);
    const props = options.props ? (Array.isArray(options.props) ? options.props : [options.props]) : [];
    this.propKinds = props.map((style: ChunkLayerStyle) => new LayerKind(style));
    this.far = options.farBake ? new FarBake(options.chunkSize, options.farBake) : null;
    this.statics.far = this.far;
    const far = this.far ? [this.far.root] : [];
    const under = [this.lightPass, this.farUnderRoot, this.groundRoot, this.decalRoot, this.farOverRoot, this.staticRoot];
    // The pictures over every static part (an instance shown as it is under one is drawn there by it too), under the people;
    // the sun's shadows over all of it.
    if (options.roofDepth) this.root.addChild(...under, this.overRoot, this.statics.occluders, ...far, this.shadowRoot, this.entityRoot, this.edgeRoot, this.statics.seeThrough, this.castRoot);
    else this.root.addChild(...under, ...far, this.shadowRoot, this.entityRoot, this.edgeRoot, this.overRoot, this.castRoot);
  }

  setPalette(palette: number[]) {
    this.entities.shared.uniforms.uPalette = paletteArray(palette);
    this.entities.shared.update();
  }

  /**
   * Multiplies every sprite by `light` (RGB 0–1) and scales drop shadows by `shadow`, and the sun's
   * shadows from static instances and upright sprites by `sun` (the same unless given: at night
   * there is no sun to cast them, though a sprite still darkens the ground under it).
   */
  setLight(light: [number, number, number], shadow = 1, sun = shadow) {
    this.entities.setLight(light, shadow);
    this.castRoot.darkness = (this.options.castShadow ?? 0.2) * sun;
    for (const kind of this.propKinds) kind.setLight(light, shadow);
    const rgb = light.reduce((v, c) => (v << 8) | Math.round(Math.max(0, Math.min(1, c)) * 255), 0);
    if (rgb !== this.lightTint) {
      this.lightTint = rgb;
      for (const view of this.views.values()) for (const tree of [view.decals, view.farUnder, view.farOver]) if (tree) tintTree(tree, rgb);
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
   * Sets a chunk's far picture, a stand-in for what it shows from far off before its own parts are
   * made: `under` draws beneath every chunk's ground (so the ground covers it once painted), `over`
   * over the decals and under the static instances (so they cover it once built). Chunk-local
   * units, tinted by `setLight` like decals. The scene owns them from here; null clears either,
   * undefined leaves it as it is.
   */
  setFar(cx: number, cy: number, under: PIXI.DisplayObject | null | undefined, over?: PIXI.DisplayObject | null) {
    const view = this.view(cx, cy);
    if (under !== undefined) view.farUnder = this.wrapFar(view.farUnder, under, this.farUnderRoot, cx, cy);
    if (over !== undefined) view.farOver = this.wrapFar(view.farOver, over, this.farOverRoot, cx, cy);
  }

  private wrapFar(old: PIXI.Container | null, object: PIXI.DisplayObject | null, root: PIXI.Container, cx: number, cy: number) {
    old?.destroy({ children: true });
    if (!object) return null;
    const holder = new PIXI.Container();
    holder.position.set(cx * this.options.chunkSize, cy * this.options.chunkSize);
    holder.addChild(object);
    tintTree(holder, this.lightTint);
    root.addChild(holder);
    return holder;
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
      view = { cx, cy, ground, decals: null, farUnder: null, farOver: null, layer: null, props: null, propSets: [] };
      this.views.set(key, view);
    }
    return view;
  }

  /** An independently owned pawn layer for scene-authored figures, using this scene's style. */
  createPawnLayer(cx: number, cy: number, expectedInterval = 50) {
    return this.createLayer(this.entities, cx, cy, expectedInterval);
  }

  private createLayer(kind: LayerKind, cx: number, cy: number, expectedInterval = this.options.snapshotInterval ?? 50) {
    const layer = new ChunkLayer(kind, this.options.chunkSize, expectedInterval, this.options.tickInterval ?? expectedInterval);
    layer.setPosition(cx * this.options.chunkSize, cy * this.options.chunkSize);
    if (this.options.roofDepth) for (const pass of [layer.shadow, layer.glow]) if (pass) pass.state.depthTest = true;
    if (layer.shadow) this.shadowRoot.addChild(layer.shadow);
    if (layer.glow) this.shadowRoot.addChild(layer.glow);
    if (layer.cast) this.castRoot.casts.addChild(layer.cast);
    // First: a building drawn over a prop's plan stands over it (what's on a roof is part of the roof's heights).
    if (layer.heights) this.castRoot.heights.addChildAt(layer.heights, 0);
    this.castRoot.surfaces.addChild(layer.surface);
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
  setPoses(cx: number, cy: number, poses: readonly PoseEntry[], tick?: number) {
    this.views.get(chunkKey(cx, cy))?.layer?.setPoses(poses, tick);
  }

  /** Holds entity `gid` in a pose in whichever chunk's layer draws it (see `ChunkLayer.holdPose`). */
  holdPose(gid: number, pose: PoseKind, turn = 0, look: LookKind = LOOK.Front) {
    for (const view of this.views.values()) view.layer?.holdPose(gid, pose, turn, look);
  }

  /** Holds entity `gid` turned to `look` whichever way it walks (see `Facings.face`), -1 lets it go; nothing without a rig's follow. */
  face(gid: number, look: LookKind | -1) {
    this.entities.facings?.face(gid, look);
  }

  /** Lets go an entity `holdPose` held. */
  releasePose(gid: number) {
    for (const view of this.views.values()) view.layer?.releasePose(gid);
  }

  /** Poses entity `gid` in whichever chunk's layer draws it (see `ChunkLayer.poseEntity`); -1 lets it go. */
  poseEntity(gid: number, pose: PoseKind = POSE.Stand, turn = 0, look: LookKind = LOOK.Front) {
    for (const view of this.views.values()) view.layer?.poseEntity(gid, pose, turn, look);
  }

  /**
   * Draws entity `gid` at world (x, y) in one chunk's layer, hiding it in the rest (see
   * `ChunkLayer.place`); -1 lets it go. The layer is the one that drew it last while its snapshot
   * still has it, else any whose snapshot has it: so it neither doubles nor drops out while it is
   * handed between chunks whose layers play out a little apart.
   */
  place(gid: number, x = 0, y = 0) {
    const holds = (layer: ChunkLayer | null) => !!layer?.pair.current && layer.pair.current.gid.subarray(0, layer.pair.current.count).includes(gid);
    let key = this.placedKey;
    if (gid < 0) key = -1;
    else if (gid !== this.placedGid || !holds(this.views.get(key)?.layer ?? null)) {
      for (const [k, view] of this.views) if (holds(view.layer)) { key = k; break; }
      if (gid !== this.placedGid && !holds(this.views.get(key)?.layer ?? null)) key = -1;
    }
    this.placedGid = gid;
    this.placedKey = key;
    const size = this.options.chunkSize;
    for (const [k, view] of this.views) {
      if (!view.layer) continue;
      if (gid < 0) view.layer.place(-1);
      else if (k === key) view.layer.place(gid, x - view.cx * size, y - view.cy * size);
      else if (holds(view.layer)) view.layer.place(gid, 0, 0, false);
      else view.layer.place(-1);
    }
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
    view.farUnder?.destroy({ children: true });
    view.farOver?.destroy({ children: true });
    this.statics.drop(key);
    this.views.delete(key);
  }

  /**
   * Culls chunks outside `view` (world units, expanded by one chunk for strays) and sets each
   * layer's interpolation point. With `farBake`, `far` gives the zoom and the renderer that makes
   * the far-off chunks' pictures.
   */
  update(view: { minX: number; minY: number; maxX: number; maxY: number }, now = performance.now(), far?: { zoom: number; renderer: PIXI.Renderer }) {
    if (this.far && far) this.far.update(far.renderer, far.zoom, view, now);
    const size = this.options.chunkSize;
    this.entities.setTime(now / 1000);
    let drawn = 0;
    for (const chunk of this.views.values()) {
      const x = chunk.cx * size;
      const y = chunk.cy * size;
      const inView = x + size * 1.1 >= view.minX && x - size * 0.1 <= view.maxX && y + size * 1.1 >= view.minY && y - size * 0.1 <= view.maxY;
      chunk.ground.visible = inView;
      if (chunk.decals) chunk.decals.visible = inView;
      if (chunk.farUnder) chunk.farUnder.visible = inView;
      if (chunk.farOver) chunk.farOver.visible = inView;
      for (const props of chunk.propSets) props?.setVisible(inView && props.count > 0);
      if (chunk.layer) {
        // Off screen too, so what reads the pair (effects, sounds) keeps time and the queue drains.
        chunk.layer.pair.advance(now);
        const visible = inView && chunk.layer.drawnCount > 0;
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
