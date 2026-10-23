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
 */
import * as PIXI from "pixi.js";
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
  /** Builds the parts in local coordinates; called once, when the id is first listed. */
  build: () => StaticParts;
};

export type StaticInstance = {
  readonly spec: StaticSpec;
  readonly under: PIXI.Container;
  readonly over: PIXI.Container;
  readonly bounds: Rect;
  /** Chunk keys that list the instance. */
  readonly holders: Set<number>;
};

const place = (c: PIXI.Container, s: StaticSpec) => {
  c.position.set(s.x, s.y);
  c.rotation = s.angle;
};

/** Multiplies plain sprites, meshes with a mesh material, and graphics by `rgb`. */
export const tintTree = (object: PIXI.DisplayObject, rgb: number) => {
  if (object instanceof PIXI.Sprite || object instanceof PIXI.Graphics) object.tint = rgb;
  else if (object instanceof PIXI.Mesh && object.shader instanceof PIXI.MeshMaterial) object.tint = rgb;
  if (object instanceof PIXI.Container) for (const child of object.children) tintTree(child, rgb);
};

/** The instances of a scene; see ChunkScene.setStatics. */
export class StaticSet {
  readonly items = new Map<string | number, StaticInstance>();
  private tint = 0xffffff;

  constructor(
    private readonly underRoot: PIXI.Container,
    private readonly overRoot: PIXI.Container,
  ) {}

  /** Replaces the instances listed by chunk `key`. */
  list(key: number, specs: readonly StaticSpec[]) {
    const ids = new Set(specs.map((s) => s.id));
    for (const item of this.items.values()) {
      if (item.holders.has(key) && !ids.has(item.spec.id)) this.release(item, key);
    }
    for (const spec of specs) {
      let item = this.items.get(spec.id);
      if (!item) {
        const parts = spec.build();
        const under = new PIXI.Container();
        const over = new PIXI.Container();
        if (parts.under) under.addChild(parts.under);
        if (parts.over) over.addChild(parts.over);
        place(under, spec);
        place(over, spec);
        if (spec.z) {
          over.zIndex = spec.z;
          this.overRoot.sortableChildren = true;
        }
        tintTree(under, this.tint);
        tintTree(over, this.tint);
        this.underRoot.addChild(under);
        this.overRoot.addChild(over);
        item = { spec, under, over, bounds: rotatedBounds(spec.x, spec.y, spec.w, spec.h, spec.angle), holders: new Set() };
        this.items.set(spec.id, item);
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
  }

  /** Instances whose local rectangle contains the world point. */
  at(x: number, y: number) {
    const hits: StaticInstance[] = [];
    for (const item of this.items.values()) {
      const b = item.bounds;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      const s = item.spec;
      const p = toLocal(s.x, s.y, s.angle, x, y);
      if (p.x >= 0 && p.y >= 0 && p.x <= s.w && p.y <= s.h) hits.push(item);
    }
    return hits;
  }

  cull(view: Rect) {
    for (const item of this.items.values()) {
      const b = item.bounds;
      const visible = b.maxX >= view.minX && b.minX <= view.maxX && b.maxY >= view.minY && b.minY <= view.maxY;
      item.under.visible = visible;
      item.over.visible = visible && item.over.children.length > 0;
    }
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
  }
}
