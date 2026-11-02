/**
 * Static world art that is not on the tile grid, for ChunkScene:
 *
 *  - decals: per-chunk display objects drawn over the ground and under every sprite (road and rail
 *    meshes built with "yage/streaming/vector", markings, yards), positioned at the chunk origin
 *    and culled with the chunk;
 *  - static instances: objects placed at any world position and angle (building prefabs), built
 *    in their own local frame. An instance can be listed by every chunk it overlaps under one
 *    stable id: it is built once, on its first listing, and destroyed when no chunk lists it.
 *    Each has an `under` part (floors, walls; under every sprite) and an optional `over` part
 *    (roofs; over every sprite, so it can fade when someone is inside).
 *
 * With depth-sorted roofs (ChunkScene's `roofDepth`) the `over` parts draw before the sprites
 * instead, each with a depth occluder over its rectangle (`occluderMesh`): every point of the roof
 * takes the depth of the footprint's near (screen-bottom) edge below it, so a sprite whose feet are
 * nearer than that edge (someone on the pavement in front) draws over the roof and one whose feet
 * are behind it (someone inside) stays hidden. A faded roof (alpha ≤ 0.6, see-through) drops its
 * occluder and draws after the sprites instead (`StaticSet.seeThrough`), at the same depth: over
 * whoever is behind it, half seen through it, and under whoever is in front.
 * The occluders stand in their own container (`StaticSet.occluders`, after the over parts).
 * An instance whose over part stands up the screen past its rectangle (a building's walls and the
 * roof on top of them: `rise`) has its occluder reach that far up too, at the same near-edge depth.
 */
import * as PIXI from "pixi.js";
import { withinFrame } from "../game/FrameBudget";
import type { FarBake } from "./far";
import type { ShadowPass } from "./shadow-pass";
import { rotatedBounds, toLocal, type Point, type Rect, type VectorMesh } from "./vector";
import { footprintContains, footprintCovers, footprintSlabs, type StaticFootprint } from "./polygon-depth";

/** A Pixi geometry with `aVertexPosition` plus one attribute per mesh attribute (`uv` → `aUv`). */
export const meshGeometry = (mesh: VectorMesh) => {
  const geometry = new PIXI.Geometry().addAttribute("aVertexPosition", new Float32Array(mesh.positions), 2);
  for (const [name, a] of Object.entries(mesh.attributes)) {
    geometry.addAttribute(`a${name[0].toUpperCase()}${name.slice(1)}`, new Float32Array(a.data), a.size);
  }
  const vertices = mesh.positions.length / 2;
  geometry.addIndex(vertices > 65535 ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices));
  return geometry;
};

/** Triangulates a simple polygon (e.g. a junction's area) into a mesh with a `uv` = position. */
export const fillPolygon = (points: readonly Point[]): VectorMesh => {
  const flat = points.flatMap((p) => [p.x, p.y]);
  return { positions: flat, attributes: { uv: { size: 2, data: [...flat] } }, indices: PIXI.utils.earcut(flat) };
};

export type StaticParts = {
  under?: PIXI.DisplayObject;
  over?: PIXI.DisplayObject;
  /**
   * What it stands up from the ground, seen from straight above in its own frame, each shape filled
   * with `solidColor(top, base)` (shadow-pass.ts; `heightColor(height)` for one standing on the ground): the scene's one shadow pass casts the sun's shadows
   * from it, onto the ground, other instances' roofs and its own alike.
   */
  heights?: PIXI.DisplayObject;
  /** The tops it shows on screen (roofs, where its `over` draws them), each filled with `heightColor(height, rise)`: what the shadow pass shades. */
  tops?: PIXI.DisplayObject;
};

export type StaticSpec = {
  /** Stable across every chunk that lists the instance. */
  id: string | number;
  /** Where the local origin (0, 0) lands, in world units. */
  x: number;
  y: number;
  /** Radians; local +x points along (cos, sin) and local +y along (−sin, cos). */
  angle: number;
  /** Local size, world units: bounds for culling and `at`. */
  w: number;
  h: number;
  /** Measured outer outline and holes, in the same local units as w/h. Omitted for rectangles. */
  footprint?: StaticFootprint;
  /** Stacking of the `over` part among other instances' (e.g. a building's height, so a tall roof and
   *  the shadow it casts lie over a lower neighbour's). Equal heights keep listing order. */
  z?: number;
  /** How far (world units) the over part reaches straight up the screen past the rectangle (a
   *  building's walls, its roof on top): culled with it, and its occluder reaches as far. */
  rise?: number;
  /** Builds the parts in local coordinates; called once, when the id is first listed. */
  build: () => StaticParts;
};

export type StaticInstance = {
  readonly spec: StaticSpec;
  readonly under: PIXI.Container;
  readonly over: PIXI.Container;
  /** Its heights and tops (`StaticParts`), in the scene's shadow pass. */
  readonly heights: PIXI.Container;
  readonly tops: PIXI.Container;
  /** The over part's depth occluder (depth-sorted roofs only). */
  readonly occluder: PIXI.Mesh<PIXI.Shader> | null;
  readonly bounds: Rect;
  /** Chunk keys that list the instance. */
  readonly holders: Set<number>;
};

/** Where an instance reaches (world), its rise included. */
const boundsOf = (s: StaticSpec): Rect => {
  const b = rotatedBounds(s.x, s.y, s.w, s.h, s.angle);
  return { ...b, minY: b.minY - (s.rise ?? 0) };
};

const place = (c: PIXI.Container, s: StaticSpec) => {
  c.position.set(s.x, s.y);
  c.rotation = s.angle;
};

const EMISSIVE = new WeakSet<PIXI.DisplayObject>();
/** Marks what gives light (a lit window, neon, a lamp's glow): the scene's tint never dims it or what it holds. */
export const emissive = <T extends PIXI.DisplayObject>(object: T) => (EMISSIVE.add(object), object);

/** Multiplies plain sprites, meshes with a mesh material, and graphics by `rgb`, all but what is emissive. */
export const tintTree = (object: PIXI.DisplayObject, rgb: number) => {
  if (EMISSIVE.has(object)) return;
  if (object instanceof PIXI.Sprite || object instanceof PIXI.Graphics) object.tint = rgb;
  else if (object instanceof PIXI.Mesh && object.shader instanceof PIXI.MeshMaterial) object.tint = rgb;
  if (object instanceof PIXI.Container) for (const child of object.children) tintTree(child, rgb);
};

const occluderVertex = `
attribute vec2 aVertexPosition;
attribute vec2 aNear;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;

void main() {
  mat3 m = projectionMatrix * translationMatrix;
  vec3 clip = m * vec3(aVertexPosition, 1.0);
  vec3 near = m * vec3(aNear, 1.0);
  // The same depth a sprite with its feet at \`near\` gets (layer.ts): lower on screen is nearer.
  gl_Position = vec4(clip.xy, clamp(near.y * 0.5, -0.999, 0.999), 1.0);
}
`;
const occluderFragment = `
precision mediump float;
void main() {
  gl_FragColor = vec4(0.0);
}
`;
let occluderProgram: PIXI.Program | null = null;

/**
 * A w × h rectangle turned by `angle` (world axes from its origin): its corners, their sorted x, and
 * its near edge as a sprite `reach` wide each side meets it: under each x, the nearest of the
 * rectangle's lower (screen-bottom) edge across x ± reach (held at the corners past its sides). A
 * sprite draws at its feet's one depth, so on an edge that runs down the screen its far side would
 * otherwise reach under the wall nearer than its feet and be cut off where they cross.
 * `cuts` lists the x where that edge bends, between `from` and `to`.
 */
const nearEdgeOf = (w: number, h: number, angle: number, reach: number) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const world = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c }));
  const xs = world.map((p) => p.x).sort((a, b) => a - b);
  const clamp = (x: number) => Math.max(xs[0], Math.min(xs[3], x));
  // The rectangle's lowest-on-screen y at world x (clamped to its sides).
  const bottom = (at: number) => {
    const x = clamp(at);
    let hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const a = world[i];
      const b = world[(i + 1) % 4];
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      if (x < x0 - 1e-6 || x > x1 + 1e-6) continue;
      hi = Math.max(hi, x1 - x0 < 1e-4 ? Math.max(a.y, b.y) : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x));
    }
    return hi;
  };
  // The bottom edge is convex upward (a rectangle), so its nearest across the window is at one end.
  const near = (x: number) => Math.min(bottom(x - reach), bottom(x + reach));
  const cuts = (from: number, to: number) => {
    const at = [from, to, ...xs.flatMap((x) => [x - reach, x, x + reach])].filter((x) => x >= from && x <= to).sort((a, b) => a - b);
    const out: number[] = [];
    for (const x of at) if (!out.length || x - out[out.length - 1] > 1e-4) out.push(x);
    // Where the window's two ends swap as the nearer, between bends.
    const gap = (x: number) => bottom(x - reach) - bottom(x + reach);
    for (let i = out.length - 2; i >= 0; i--) {
      const [a, b] = [out[i], out[i + 1]];
      const [ga, gb] = [gap(a), gap(b)];
      if (ga * gb < 0) out.splice(i + 1, 0, a + ((b - a) * ga) / (ga - gb));
    }
    return out;
  };
  return { world, xs, near, cuts };
};

/**
 * The depth-slab polygons of a w × h local rectangle turned by `angle` (world: local +x along
 * (cos, sin)): the rectangle cut into vertical strips at its corners' x, each with its corners and,
 * per corner, the point under it on the rectangle's near edge as a sprite `reach` wide meets it
 * (`nearEdgeOf`; straight below on its lower edge for none); each strip reaching `rise` further up
 * the screen. Local units.
 */
export const occluderSlabs = (w: number, h: number, angle: number, rise = 0, reach = 0) => {
  const { world, xs, near, cuts } = nearEdgeOf(w, h, angle, reach);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const local = (p: Point): Point => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c });
  // Lowest and highest world y of the rectangle at world x.
  const span = (x: number) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const a = world[i];
      const b = world[(i + 1) % 4];
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      if (x < x0 - 1e-6 || x > x1 + 1e-6) continue;
      if (x1 - x0 < 1e-4) {
        lo = Math.min(lo, a.y, b.y);
        hi = Math.max(hi, a.y, b.y);
        continue;
      }
      const y = a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    return { lo, hi };
  };
  const at = cuts(xs[0], xs[3]);
  const slabs: { corners: Point[]; near: Point[] }[] = [];
  for (let i = 0; i + 1 < at.length; i++) {
    const xa = at[i];
    const xb = at[i + 1];
    const a = span(xa);
    const b = span(xb);
    const corners = [
      { x: xa, y: a.lo - rise },
      { x: xb, y: b.lo - rise },
      { x: xb, y: b.hi },
      { x: xa, y: a.hi },
    ];
    const [na, nb] = [{ x: xa, y: near(xa) }, { x: xb, y: near(xb) }];
    slabs.push({ corners: corners.map(local), near: [na, nb, nb, na].map(local) });
  }
  return slabs;
};

/** A depth-only mesh over a static's local rectangle; see the module notes. */
export const occluderMesh = (w: number, h: number, angle: number, rise = 0, reach = 0, footprint?: StaticFootprint) => {
  const positions: number[] = [];
  const near: number[] = [];
  const indices: number[] = [];
  for (const slab of footprint ? footprintSlabs(footprint, angle, rise, reach) : occluderSlabs(w, h, angle, rise, reach)) {
    const base = positions.length / 2;
    for (let k = 0; k < 4; k++) {
      positions.push(slab.corners[k].x, slab.corners[k].y);
      near.push(slab.near[k].x, slab.near[k].y);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return depthMesh(positions, near, indices);
};

/**
 * The see-through pass's strips (`occluderSlabs` in world axes, from the static's origin): the
 * rectangle's near-edge depth (as a sprite `reach` wide meets it) under every point of `reach`
 * (where its over part draws, world units from the origin; past the rectangle's sides, its
 * nearest corner's).
 */
export const seeThroughSlabs = (w: number, h: number, angle: number, around: Rect, reach = 0) => {
  const { near, cuts } = nearEdgeOf(w, h, angle, reach);
  const at = cuts(around.minX, around.maxX);
  const slabs: { corners: Point[]; near: Point[] }[] = [];
  for (let i = 0; i + 1 < at.length; i++) {
    const [xa, xb] = [at[i], at[i + 1]];
    const [na, nb] = [{ x: xa, y: near(xa) }, { x: xb, y: near(xb) }];
    slabs.push({
      corners: [
        { x: xa, y: around.minY },
        { x: xb, y: around.minY },
        { x: xb, y: around.maxY },
        { x: xa, y: around.maxY },
      ],
      near: [na, nb, nb, na],
    });
  }
  return slabs;
};

const seeThroughVertex = `
attribute vec2 aVertexPosition;
attribute vec2 aNear;
uniform mat3 projectionMatrix;
uniform mat3 translationMatrix;
uniform vec4 uFrame;
varying vec2 vUv;

void main() {
  vec3 seen = translationMatrix * vec3(aVertexPosition, 1.0);
  vec3 clip = projectionMatrix * seen;
  vec3 near = projectionMatrix * translationMatrix * vec3(aNear, 1.0);
  vUv = (seen.xy - uFrame.xy) * uFrame.zw;
  gl_Position = vec4(clip.xy, clamp(near.y * 0.5, -0.999, 0.999), 1.0);
}
`;
const seeThroughFragment = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uPicture;
uniform vec2 uMax;

void main() {
  if (vUv.x < 0.0 || vUv.y < 0.0 || vUv.x > uMax.x || vUv.y > uMax.y) discard;
  gl_FragColor = texture2D(uPicture, vUv);
}
`;
let seeThroughProgram: PIXI.Program | null = null;

/**
 * Draws the see-through (faded) instances' over parts after the sprites: each taken as it draws
 * into a picture of its own, laid back over the scene on its `seeThroughSlabs` with the depth of
 * its near edge (depth-tested, not written), so the sprites in front of it keep it off them.
 */
class SeeThrough extends PIXI.Container {
  readonly faded = new Set<StaticInstance>();
  /** Half a sprite's width (`StaticSet`'s `reach`). */
  reach = 0;
  private readonly drawn = new Map<StaticInstance, { picture: PIXI.RenderTexture; mesh: PIXI.Mesh<PIXI.Shader> }>();

  /** Whether the instance draws here (and not with the other over parts): faded and shown. */
  set(item: StaticInstance, faded: boolean) {
    (item.over as { renderable: boolean }).renderable = !faded;
    if (faded) this.faded.add(item);
    else this.drop(item);
  }

  drop(item: StaticInstance) {
    this.faded.delete(item);
    const drawn = this.drawn.get(item);
    if (!drawn) return;
    this.drawn.delete(item);
    drawn.picture.destroy(true);
    drawn.mesh.destroy();
  }

  override render(renderer: PIXI.Renderer) {
    if (!this.visible || !this.faded.size) return;
    // The projection (a camera may have put its view in: yage ProjectedCamera) takes the over parts'
    // world to the screen: what of the world shows, and how many pixels a world unit takes.
    const projection = renderer.projection.projectionMatrix;
    const view = renderer.renderTexture.destinationFrame;
    const sx = (Math.abs(projection.a) * view.width * renderer.resolution) / 2;
    const sy = (Math.abs(projection.d) * view.height * renderer.resolution) / 2;
    const corner = (x: number, y: number) => projection.applyInverse({ x, y });
    const [a, b] = [corner(-1, -1), corner(1, 1)];
    const shown = { minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y) };
    for (const item of this.faded) {
      const over = item.over;
      if (over.destroyed || !over.visible || over.worldAlpha <= 0.004) continue;
      const bounds = over.getBounds(true);
      const minX = Math.max(bounds.x, shown.minX);
      const minY = Math.max(bounds.y, shown.minY);
      const maxX = Math.min(bounds.x + bounds.width, shown.maxX);
      const maxY = Math.min(bounds.y + bounds.height, shown.maxY);
      if (maxX <= minX || maxY <= minY) continue;
      const [w, h] = [Math.ceil((maxX - minX) * sx), Math.ceil((maxY - minY) * sy)];
      const { picture, mesh } = this.drawnOf(item, w, h);
      // The over part as it would have drawn, into its picture at the screen's density.
      renderer.batch.flush();
      const target = renderer.renderTexture;
      const [current, source, destination, saved] = [target.current, target.sourceFrame.clone(), target.destinationFrame.clone(), projection.clone()];
      target.bind(picture, new PIXI.Rectangle(minX, minY, maxX - minX, maxY - minY), new PIXI.Rectangle(0, 0, w, h));
      target.clear([0, 0, 0, 0]);
      (over as { renderable: boolean }).renderable = true;
      over.render(renderer);
      (over as { renderable: boolean }).renderable = false;
      renderer.batch.flush();
      target.bind(current ?? undefined, source, destination);
      renderer.projection.projectionMatrix.copyFrom(saved);
      renderer.globalUniforms.update();
      // Laid back over the scene where it reaches, at its near edge's depth.
      const reach = over.getLocalBounds(undefined, true);
      const corners = [
        [reach.x, reach.y],
        [reach.x + reach.width, reach.y],
        [reach.x + reach.width, reach.y + reach.height],
        [reach.x, reach.y + reach.height],
      ].map(([x, y]) => over.localTransform.apply({ x, y }));
      const around = {
        minX: Math.min(...corners.map((p) => p.x)) - item.spec.x,
        maxX: Math.max(...corners.map((p) => p.x)) - item.spec.x,
        minY: Math.min(...corners.map((p) => p.y)) - item.spec.y,
        maxY: Math.max(...corners.map((p) => p.y)) - item.spec.y,
      };
      const positions: number[] = [];
      const near: number[] = [];
      const indices: number[] = [];
      const c = Math.cos(item.spec.angle), s = Math.sin(item.spec.angle);
      const screen = (p: Point) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
      const slabs = item.spec.footprint
        ? footprintSlabs(item.spec.footprint, item.spec.angle, item.spec.rise, this.reach).map((slab) => ({
          corners: slab.corners.map(screen), near: slab.near.map(screen),
        })) : seeThroughSlabs(item.spec.w, item.spec.h, item.spec.angle, around, this.reach);
      for (const slab of slabs) {
        const base = positions.length / 2;
        for (let k = 0; k < 4; k++) {
          positions.push(slab.corners[k].x, slab.corners[k].y);
          near.push(slab.near[k].x, slab.near[k].y);
        }
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
      const geometry = mesh.geometry;
      geometry.getBuffer("aVertexPosition").update(new Float32Array(positions));
      geometry.getBuffer("aNear").update(new Float32Array(near));
      geometry.getIndex().update(positions.length / 2 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices));
      const uniforms = mesh.shader.uniforms;
      const [u, v] = [w / picture.width, h / picture.height];
      uniforms.uFrame = new Float32Array([minX, minY, u / (maxX - minX), v / (maxY - minY)]);
      uniforms.uMax = new Float32Array([u, v]);
      mesh.position.set(item.spec.x, item.spec.y);
      mesh.transform.updateTransform(over.parent.transform);
      mesh.render(renderer);
    }
  }

  /** The instance's picture (at least w × h px) and the mesh that lays it. */
  private drawnOf(item: StaticInstance, w: number, h: number) {
    let drawn = this.drawn.get(item);
    if (drawn && (drawn.picture.width < w || drawn.picture.height < h)) {
      drawn.picture.resize(Math.max(drawn.picture.width, Math.ceil(w / 64) * 64), Math.max(drawn.picture.height, Math.ceil(h / 64) * 64));
    }
    if (drawn) return drawn;
    seeThroughProgram ??= PIXI.Program.from(seeThroughVertex, seeThroughFragment, "yage-static-see-through");
    const picture = PIXI.RenderTexture.create({ width: Math.ceil(w / 64) * 64, height: Math.ceil(h / 64) * 64 });
    const geometry = new PIXI.Geometry()
      .addAttribute("aVertexPosition", new Float32Array(48), 2)
      .addAttribute("aNear", new Float32Array(48), 2)
      .addIndex(new Uint16Array(36));
    const state = PIXI.State.for2d();
    state.depthTest = true;
    state.depthMask = false;
    state.blend = true;
    const mesh = new PIXI.Mesh(geometry, new PIXI.Shader(seeThroughProgram, { uPicture: picture, uFrame: new Float32Array(4), uMax: new Float32Array(2) }), state);
    drawn = { picture, mesh };
    this.drawn.set(item, drawn);
    return drawn;
  }
}

/** A depth-only mesh of occluder triangles: each vertex with the near-edge point that sets its depth. */
export const depthMesh = (positions: number[], near: number[], indices: number[]) => {
  occluderProgram ??= PIXI.Program.from(occluderVertex, occluderFragment, "yage-static-occluder");
  const index = positions.length / 2 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
  const geometry = new PIXI.Geometry().addAttribute("aVertexPosition", new Float32Array(positions), 2).addAttribute("aNear", new Float32Array(near), 2).addIndex(index);
  const state = PIXI.State.for2d();
  state.depthTest = true;
  state.depthMask = true;
  state.blend = true;
  const mesh = new PIXI.Mesh(geometry, new PIXI.Shader(occluderProgram, {}), state);
  mesh.eventMode = "none";
  return mesh;
};

/** World px per side of a StaticSet's lookup cell. */
/** Squared distance from a bounds' centre to a point. */
const distance = (b: Rect, x: number, y: number) => ((b.minX + b.maxX) / 2 - x) ** 2 + ((b.minY + b.maxY) / 2 - y) ** 2;
const CELL = 512;
const cellKey = (i: number, j: number) => (i & 0xffff) * 65536 + (j & 0xffff);

/** The instances of a scene; see ChunkScene.setStatics. */
/** Newly seen instances past which a cull builds its whole budget, whatever the frame has left. */
const BUILD_BACKLOG = 16;
/** How far (world units) past its instance's bounds a ground shadow may reach: drawn while that near the view. */
const CAST_REACH = 320;

export class StaticSet {
  readonly items = new Map<string | number, StaticInstance>();
  /** Each lookup cell's instances (those whose bounds reach it), so `at` looks only near the point. */
  private readonly cells = new Map<number, StaticInstance[]>();
  private tint = 0xffffff;
  /** The over parts' depth occluders, placed as their instances are; drawn after the over parts, before the sprites. */
  readonly occluders = new PIXI.Container();
  /** The see-through (faded) over parts, drawn after the sprites (depth-sorted roofs only; see the module notes). */
  readonly seeThrough = new SeeThrough();

  constructor(
    private readonly underRoot: PIXI.Container,
    private readonly overRoot: PIXI.Container,
    /** Give every over part a depth occluder (ChunkScene's `roofDepth`). */
    private readonly occlude = false,
    /**
     * Build an instance's parts the first time a cull finds it in view instead of when it is first
     * listed (ChunkScene's `buildStatics: "seen"`): instances never looked at cost nothing.
     */
    private readonly lazy = false,
    /**
     * Milliseconds a cull may spend building newly seen instances (lazy only), nearest the view's
     * centre first and within the frame's shared budget (yage/game/FrameBudget); the rest stay
     * hidden until a later cull. At least one builds per cull.
     */
    private readonly buildBudget = Infinity,
    /**
     * Milliseconds a cull always gets for building (lazy, budgeted only), whatever the frame's shared
     * budget has left: a pan brings buildings into view every frame, and while the frame is full the
     * one-a-cull minimum leaves whole blocks empty.
     */
    private readonly buildFloor = 0,
    /** The scene's shadow pass, which takes the instances' heights and tops; without one they cast no shadows. */
    private readonly shadow: ShadowPass | null = null,
    /**
     * Half the widest sprite's width (world units; ChunkScene's `roofReach`): how far either side of
     * its feet a sprite's depth has to hold against an occluder's near edge (`nearEdgeOf`).
     */
    private readonly reach = 0,
  ) {
    this.seeThrough.reach = reach;
  }

  private readonly seen: StaticInstance[] = [];

  /** Far-off chunks' pictures (ChunkScene's `farBake`): told of every instance and change, and hiding the instances it draws. */
  far: FarBake | null = null;

  /** Listed instances whose parts are not built yet (lazy only). */
  private readonly unbuilt = new Set<StaticInstance>();

  private build(item: StaticInstance) {
    const parts = item.spec.build();
    if (parts.under) item.under.addChild(parts.under);
    if (parts.over) item.over.addChild(parts.over);
    if (parts.heights) item.heights.addChild(parts.heights);
    if (parts.tops) item.tops.addChild(parts.tops);
    tintTree(item.under, this.tint);
    tintTree(item.over, this.tint);
    if (this.occlude && parts.over) {
      const occluder = occluderMesh(item.spec.w, item.spec.h, item.spec.angle, item.spec.rise, this.reach, item.spec.footprint);
      place(occluder, item.spec);
      occluder.visible = item.over.visible;
      this.occluders.addChild(occluder);
      this.shadow?.occluders.add(occluder);
      (item as { occluder: PIXI.Mesh<PIXI.Shader> | null }).occluder = occluder;
    }
    this.far?.changed(item);
  }

  /** Replaces the instances listed by chunk `key`. */
  list(key: number, specs: readonly StaticSpec[]) {
    const ids = new Set(specs.map((s) => s.id));
    for (const item of this.items.values()) {
      if (item.holders.has(key) && !ids.has(item.spec.id)) this.release(item, key);
    }
    for (const spec of specs) {
      let item = this.items.get(spec.id);
      if (!item) {
        const under = new PIXI.Container();
        const over = new PIXI.Container();
        const heights = new PIXI.Container();
        const tops = new PIXI.Container();
        place(under, spec);
        place(over, spec);
        place(heights, spec);
        place(tops, spec);
        if (spec.z) {
          over.zIndex = tops.zIndex = spec.z;
          this.overRoot.sortableChildren = true;
          if (this.shadow) this.shadow.tops.sortableChildren = true;
        }
        this.underRoot.addChild(under);
        this.overRoot.addChild(over);
        this.shadow?.heights.addChild(heights);
        this.shadow?.tops.addChild(tops);
        item = { spec, under, over, heights, tops, occluder: null, bounds: boundsOf(spec), holders: new Set() };
        this.items.set(spec.id, item);
        this.index(item, true);
        this.far?.add(item);
        if (this.lazy) {
          // Hidden until a cull sees it and builds it.
          under.visible = over.visible = heights.visible = tops.visible = false;
          this.unbuilt.add(item);
        } else this.build(item);
      }
      item.holders.add(key);
    }
  }

  /** Drops chunk `key`'s listings. */
  drop(key: number) {
    for (const item of [...this.items.values()]) if (item.holders.has(key)) this.release(item, key);
  }

  private release(item: StaticInstance, key: number) {
    item.holders.delete(key);
    if (item.holders.size) return;
    item.under.destroy({ children: true });
    this.seeThrough.drop(item);
    item.over.destroy({ children: true });
    item.occluder?.destroy();
    item.heights.destroy({ children: true });
    item.tops.destroy({ children: true });
    this.far?.remove(item);
    this.items.delete(item.spec.id);
    this.index(item, false);
    this.unbuilt.delete(item);
  }

  /** Adds `item` to (or takes it from) every lookup cell its bounds reach. */
  private index(item: StaticInstance, add: boolean) {
    const b = item.bounds;
    for (let j = Math.floor(b.minY / CELL); j <= Math.floor(b.maxY / CELL); j++) {
      for (let i = Math.floor(b.minX / CELL); i <= Math.floor(b.maxX / CELL); i++) {
        const key = cellKey(i, j);
        const cell = this.cells.get(key);
        if (add) {
          if (cell) cell.push(item);
          else this.cells.set(key, [item]);
        } else if (cell) {
          cell.splice(cell.indexOf(item), 1);
          if (!cell.length) this.cells.delete(key);
        }
      }
    }
  }

  /** Instances whose local rectangle contains the world point. */
  at(x: number, y: number) {
    const hits: StaticInstance[] = [];
    for (const item of this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      const b = item.bounds;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      const s = item.spec;
      const p = toLocal(s.x, s.y, s.angle, x, y);
      if (p.x >= 0 && p.y >= 0 && p.x <= s.w && p.y <= s.h && (!s.footprint || footprintContains(s.footprint, p))) hits.push(item);
    }
    return hits;
  }

  /**
   * Instances whose over part covers the world point on screen: its rectangle, or the walls and
   * roof standing `rise` up the screen from it (someone there is behind them).
   */
  covering(x: number, y: number) {
    const hits: StaticInstance[] = [];
    for (const item of this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []) {
      const b = item.bounds;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      // The screen-down segment from the point, `rise` long, against the rectangle (in its frame).
      const s = item.spec;
      const a = toLocal(s.x, s.y, s.angle, x, y);
      const e = toLocal(s.x, s.y, s.angle, x, y + (s.rise ?? 0));
      if (s.footprint) {
        if (footprintCovers(s.footprint, a, e)) hits.push(item);
        continue;
      }
      let t0 = 0;
      let t1 = 1;
      for (const [p, d, lo, hi] of [
        [a.x, e.x - a.x, 0, s.w],
        [a.y, e.y - a.y, 0, s.h],
      ]) {
        if (Math.abs(d) < 1e-9) {
          if (p < lo || p > hi) t1 = -1;
          continue;
        }
        const [u, v] = [(lo - p) / d, (hi - p) / d];
        t0 = Math.max(t0, Math.min(u, v));
        t1 = Math.min(t1, Math.max(u, v));
      }
      if (t0 <= t1) hits.push(item);
    }
    return hits;
  }

  /** Whether a roof hides the world point: a shown, unfaded over part over it. */
  roofed(x: number, y: number) {
    return this.at(x, y).some((it) => it.over.visible && it.over.alpha > 0.6 && it.over.children.length > 0);
  }

  cull(view: Rect) {
    const seen = this.seen;
    for (const item of this.items.values()) {
      const b = item.bounds;
      const visible = b.maxX >= view.minX && b.minX <= view.maxX && b.maxY >= view.minY && b.minY <= view.maxY;
      if (visible && this.unbuilt.has(item)) {
        seen.push(item);
        continue;
      }
      // A far-off chunk's picture draws its instances (FarBake); never their shadows, one pass for all
      // (which shades the tops the picture shows, and takes heights from beyond the view's edge).
      const shown = visible && !this.far?.covers(item);
      item.under.visible = shown;
      item.over.visible = shown && item.over.children.length > 0;
      item.heights.visible = item.heights.children.length > 0 && b.maxX + CAST_REACH >= view.minX && b.minX - CAST_REACH <= view.maxX && b.maxY + CAST_REACH >= view.minY && b.minY - CAST_REACH <= view.maxY;
      item.tops.visible = visible && item.tops.children.length > 0;
      // A faded roof (someone inside, or in front of someone looked for) shows the people under it, over them.
      if (item.occluder) {
        const faded = item.over.visible && item.over.alpha <= 0.6;
        item.occluder.visible = item.over.visible && !faded;
        this.seeThrough.set(item, faded);
      }
    }
    if (!seen.length) return;
    const cx = (view.minX + view.maxX) / 2;
    const cy = (view.minY + view.maxY) / 2;
    const budgeted = this.buildBudget < Infinity;
    if (budgeted) seen.sort((a, b) => distance(a.bounds, cx, cy) - distance(b.bounds, cx, cy));
    const build = (budget: number) => {
      const started = performance.now();
      for (const item of seen) {
        if (item !== seen[0] && performance.now() - started >= budget) break;
        this.unbuilt.delete(item);
        this.build(item);
        item.under.visible = true;
        item.over.visible = item.over.children.length > 0;
        if (item.occluder) {
          item.occluder.visible = item.over.visible;
          this.seeThrough.set(item, false);
        }
        item.heights.visible = item.heights.children.length > 0;
        item.tops.visible = item.tops.children.length > 0;
      }
    };
    // A budget is shared with the frame's other deferrable work (yage/game/FrameBudget).
    // A backlog in view (a jump, a zoom-out) builds the whole budget a cull, full frame or not: at the
    // floor alone a few hundred buildings stand as empty lots for a second.
    const floor = seen.length > BUILD_BACKLOG ? Math.max(this.buildFloor, this.buildBudget) : this.buildFloor;
    if (budgeted) withinFrame(this.buildBudget, (allowed) => build(Math.max(allowed, floor)));
    else build(Infinity);
    seen.length = 0;
  }

  setTint(rgb: number) {
    if (rgb === this.tint) return;
    this.tint = rgb;
    this.far?.setTint(rgb);
    for (const item of this.items.values()) {
      tintTree(item.under, rgb);
      tintTree(item.over, rgb);
    }
  }

  clear() {
    for (const item of this.items.values()) {
      this.seeThrough.drop(item);
      item.under.destroy({ children: true });
      item.over.destroy({ children: true });
      item.occluder?.destroy();
      item.heights.destroy({ children: true });
      item.tops.destroy({ children: true });
    }
    this.items.clear();
    this.cells.clear();
    this.unbuilt.clear();
    this.far?.clear();
  }
}
