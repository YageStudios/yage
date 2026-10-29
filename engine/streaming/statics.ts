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
 * are behind it (someone inside) stays hidden. A faded roof (alpha ≤ 0.6) drops its occluder.
 * An instance whose over part stands up the screen past its rectangle (a building's walls and the
 * roof on top of them: `rise`) has its occluder reach that far up too, at the same near-edge depth.
 */
import * as PIXI from "pixi.js";
import { withinFrame } from "../game/FrameBudget";
import { rotatedBounds, toLocal, type Point, type Rect, type VectorMesh } from "./vector";

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

export type StaticParts = { under?: PIXI.DisplayObject; over?: PIXI.DisplayObject };

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
 * The depth-slab polygons of a w × h local rectangle turned by `angle` (world: local +x along
 * (cos, sin)): the rectangle cut into vertical strips at its corners' x, each with its corners and,
 * per corner, the point of the rectangle's lower (screen-bottom) edge straight below it; each strip
 * reaching `rise` further up the screen. Local units.
 */
export const occluderSlabs = (w: number, h: number, angle: number, rise = 0) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const world = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c }));
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
  const xs = world.map((p) => p.x).sort((a, b) => a - b);
  const slabs: { corners: Point[]; near: Point[] }[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const xa = xs[i];
    const xb = xs[i + 1];
    if (xb - xa < 1e-4) continue;
    const a = span(xa);
    const b = span(xb);
    const corners = [
      { x: xa, y: a.lo - rise },
      { x: xb, y: b.lo - rise },
      { x: xb, y: b.hi },
      { x: xa, y: a.hi },
    ];
    const near = [
      { x: xa, y: a.hi },
      { x: xb, y: b.hi },
      { x: xb, y: b.hi },
      { x: xa, y: a.hi },
    ];
    slabs.push({ corners: corners.map(local), near: near.map(local) });
  }
  return slabs;
};

/** A depth-only mesh over a static's local rectangle; see the module notes. */
export const occluderMesh = (w: number, h: number, angle: number, rise = 0) => {
  occluderProgram ??= PIXI.Program.from(occluderVertex, occluderFragment, "yage-static-occluder");
  const positions: number[] = [];
  const near: number[] = [];
  const indices: number[] = [];
  for (const slab of occluderSlabs(w, h, angle, rise)) {
    const base = positions.length / 2;
    for (let k = 0; k < 4; k++) {
      positions.push(slab.corners[k].x, slab.corners[k].y);
      near.push(slab.near[k].x, slab.near[k].y);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new PIXI.Geometry().addAttribute("aVertexPosition", new Float32Array(positions), 2).addAttribute("aNear", new Float32Array(near), 2).addIndex(new Uint16Array(indices));
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
export class StaticSet {
  readonly items = new Map<string | number, StaticInstance>();
  /** Each lookup cell's instances (those whose bounds reach it), so `at` looks only near the point. */
  private readonly cells = new Map<number, StaticInstance[]>();
  private tint = 0xffffff;

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
  ) {}

  private readonly seen: StaticInstance[] = [];

  /** Listed instances whose parts are not built yet (lazy only). */
  private readonly unbuilt = new Set<StaticInstance>();

  private build(item: StaticInstance) {
    const parts = item.spec.build();
    if (parts.under) item.under.addChild(parts.under);
    if (parts.over) item.over.addChild(parts.over);
    tintTree(item.under, this.tint);
    tintTree(item.over, this.tint);
    if (this.occlude && parts.over) {
      const occluder = occluderMesh(item.spec.w, item.spec.h, item.spec.angle, item.spec.rise);
      item.over.addChild(occluder);
      (item as { occluder: PIXI.Mesh<PIXI.Shader> | null }).occluder = occluder;
    }
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
        place(under, spec);
        place(over, spec);
        if (spec.z) {
          over.zIndex = spec.z;
          this.overRoot.sortableChildren = true;
        }
        this.underRoot.addChild(under);
        this.overRoot.addChild(over);
        item = { spec, under, over, occluder: null, bounds: boundsOf(spec), holders: new Set() };
        this.items.set(spec.id, item);
        this.index(item, true);
        if (this.lazy) {
          // Hidden until a cull sees it and builds it.
          under.visible = over.visible = false;
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
    item.over.destroy({ children: true });
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
      if (p.x >= 0 && p.y >= 0 && p.x <= s.w && p.y <= s.h) hits.push(item);
    }
    return hits;
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
      item.under.visible = visible;
      item.over.visible = visible && item.over.children.length > 0;
      // A faded roof (someone inside) shows the people under it.
      if (item.occluder) item.occluder.visible = item.over.alpha > 0.6;
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
      }
    };
    // A budget is shared with the frame's other deferrable work (yage/game/FrameBudget).
    if (budgeted) withinFrame(this.buildBudget, (allowed) => build(Math.max(allowed, this.buildFloor)));
    else build(Infinity);
    seen.length = 0;
  }

  setTint(rgb: number) {
    if (rgb === this.tint) return;
    this.tint = rgb;
    for (const item of this.items.values()) {
      tintTree(item.under, rgb);
      tintTree(item.over, rgb);
    }
  }

  clear() {
    for (const item of this.items.values()) {
      item.under.destroy({ children: true });
      item.over.destroy({ children: true });
    }
    this.items.clear();
    this.cells.clear();
    this.unbuilt.clear();
  }
}
