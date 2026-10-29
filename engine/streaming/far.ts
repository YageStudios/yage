/**
 * Far-off static instances as one picture a chunk (ChunkScene's `farBake`).
 *
 * Zoomed far out a city's buildings are thousands of containers and hundreds of thousands of
 * vector shapes, each re-batched every frame for a building a few pixels wide. Below `below` zoom
 * each chunk's instances (those whose bounds' centre lies in it, under parts then over parts) are
 * rendered once into a texture of their own and drawn as one sprite; the instances of a chunk with
 * a picture are hidden (StaticSet.cull). A chunk without one yet shows its instances as they are,
 * so nothing goes blank while pictures are made: nearest the view's centre first, within the
 * frame's shared budget (yage/game/FrameBudget), at least one a frame.
 *
 * A chunk's picture is made again when one of its instances is added, built or dropped, when the
 * display tree under one changes (a child added or removed anywhere in it), or when the scene's
 * light tint moves on by more than TINT_STEP a channel: after the view's missing pictures, and no
 * sooner than REBAKE_MS after it was last made. Until then it keeps showing the old one, and an
 * instance added since shows as it is.
 * While an instance's over part is faded (a roof someone is inside), its whole chunk shows as it
 * is in place of the picture: the inside stacks with the walls around it as the scene does. Other
 * in-place changes are not seen: from that far they don't show.
 */
import * as PIXI from "pixi.js";
import { withinFrame } from "../game/FrameBudget";
import { depthMesh } from "./statics";
import type { Rect } from "./vector";

export type FarBakeOptions = {
  /** Zoom (screen px per world unit) under which chunks show their pictures. */
  below: number;
  /** Texture px per world unit (default `below` times the renderer's resolution, at most 0.25). */
  resolution?: number;
  /** World units a picture reaches past its chunk on each side at least (default 160); further where its instances reach. */
  pad?: number;
  /** Milliseconds a frame may spend making pictures, from the frame's shared budget (default 4). */
  budget?: number;
};

/** What a picture is made of: an instance's parts, as StaticSet holds them. */
export type FarInstance = { under: PIXI.Container; over: PIXI.Container; occluder: PIXI.DisplayObject | null; bounds: Rect };

type Tile = { sprite: PIXI.Sprite | null; depth: PIXI.Mesh<PIXI.Shader> | null; dirty: boolean; tint: number; baked: Set<FarInstance>; at: number; open: boolean; opening: boolean };

const EMPTY = new PIXI.Container();
/** Channels further apart than this make a picture stale. */
const TINT_STEP = 6;
/** Milliseconds a stale picture keeps showing before it is made again (pictures yet to be made come first). */
const REBAKE_MS = 500;
/** Out of zoom's way: pictures stay on until the zoom passes `below` by this much. */
const HYSTERESIS = 1.1;

const tintFar = (a: number, b: number) => {
  for (let shift = 0; shift <= 16; shift += 8) if (Math.abs(((a >> shift) & 255) - ((b >> shift) & 255)) > TINT_STEP) return true;
  return false;
};

export class FarBake {
  /** The pictures, where the scene's static roots are. */
  readonly root = new PIXI.Container();
  active = false;
  private readonly tiles = new Map<number, Tile>();
  private readonly members = new Map<number, Set<FarInstance>>();
  private readonly keys = new Map<FarInstance, number>();
  private readonly watched = new WeakSet<PIXI.Container>();
  private tint = 0xffffff;
  private readonly wanted: number[] = [];

  constructor(
    private readonly chunkSize: number,
    private readonly options: FarBakeOptions,
  ) {
    this.root.eventMode = "none";
    this.root.visible = false;
    // Pictures overlap (a tall building rises up the screen into the chunk behind): nearer (lower) rows over further ones.
    this.root.sortableChildren = true;
  }

  private keyOf(b: Rect) {
    const cx = Math.floor((b.minX + b.maxX) / 2 / this.chunkSize);
    const cy = Math.floor((b.minY + b.maxY) / 2 / this.chunkSize);
    return (cx & 0xffff) * 65536 + (cy & 0xffff);
  }

  private stale(key: number) {
    const tile = this.tiles.get(key);
    if (tile) tile.dirty = true;
  }

  /** An instance listed: its chunk's picture is stale. */
  add(item: FarInstance) {
    const key = this.keyOf(item.bounds);
    this.keys.set(item, key);
    let set = this.members.get(key);
    if (!set) this.members.set(key, (set = new Set()));
    set.add(item);
    this.stale(key);
  }

  /** An instance dropped. */
  remove(item: FarInstance) {
    const key = this.keys.get(item);
    if (key === undefined) return;
    this.keys.delete(item);
    const set = this.members.get(key);
    set?.delete(item);
    if (set && !set.size) {
      this.members.delete(key);
      this.drop(key);
    } else this.stale(key);
  }

  /** An instance built (or changed): its picture is stale, and so it will be at every later change under it. */
  changed(item: FarInstance) {
    const key = this.keys.get(item);
    if (key !== undefined) this.stale(key);
    this.watch(item.under, item);
    this.watch(item.over, item);
  }

  private watch(object: PIXI.Container, item: FarInstance) {
    if (this.watched.has(object)) return;
    this.watched.add(object);
    const touched = (child: PIXI.DisplayObject) => {
      this.changed(item);
      if (child instanceof PIXI.Container) this.watch(child, item);
    };
    object.on("childAdded", touched);
    object.on("childRemoved", () => this.changed(item));
    for (const child of object.children) if (child instanceof PIXI.Container) this.watch(child, item);
  }

  /** The light tint the instances carry now (StaticSet.setTint). */
  setTint(rgb: number) {
    this.tint = rgb;
  }

  /** Whether an instance is drawn by its chunk's picture (and so hidden itself). */
  covers(item: FarInstance) {
    if (!this.active) return false;
    const key = this.keys.get(item);
    if (key === undefined) return false;
    const tile = this.tiles.get(key);
    if (!tile?.sprite) return false;
    // Faded, the chunk shows as it is (from the next frame), so its inside stacks with its walls.
    if (item.over.alpha < 1) tile.opening = true;
    return !tile.open && tile.baked.has(item);
  }

  private drop(key: number) {
    const tile = this.tiles.get(key);
    if (!tile) return;
    if (tile.sprite) tile.sprite.destroy({ texture: true, baseTexture: true });
    tile.depth?.destroy();
    this.tiles.delete(key);
  }

  /**
   * Turns the pictures on or off for `zoom`, culls them to `view`, drops those well out of it and
   * makes the view's missing or stale ones within the budget. Returns whether they are on.
   */
  update(renderer: PIXI.Renderer, zoom: number, view: Rect, now = performance.now()) {
    const { below } = this.options;
    const on = this.active ? zoom < below * HYSTERESIS : zoom < below;
    if (!on) {
      if (this.active) {
        this.active = false;
        this.root.visible = false;
        for (const key of [...this.tiles.keys()]) this.drop(key);
      }
      return false;
    }
    this.active = true;
    this.root.visible = true;
    const size = this.chunkSize;
    const x0 = Math.floor(view.minX / size), x1 = Math.floor(view.maxX / size);
    const y0 = Math.floor(view.minY / size), y1 = Math.floor(view.maxY / size);
    const cx = (view.minX + view.maxX) / 2 / size - 0.5;
    const cy = (view.minY + view.maxY) / 2 / size - 0.5;
    const near = (key: number) => {
      const x = (key / 65536) << 16 >> 16, y = (key & 0xffff) << 16 >> 16;
      return { x, y, d: (x - cx) ** 2 + (y - cy) ** 2 };
    };
    for (const [key, tile] of this.tiles) {
      const { x, y } = near(key);
      if (x < x0 - 2 || x > x1 + 2 || y < y0 - 2 || y > y1 + 2) this.drop(key);
      else {
        const near = x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1;
        tile.open = tile.opening;
        tile.opening = false;
        if (tile.sprite) tile.sprite.visible = near && !tile.open;
        if (tile.depth) tile.depth.visible = near && !tile.open;
        if (!tile.dirty && tintFar(tile.tint, this.tint)) tile.dirty = true;
      }
    }
    const wanted = this.wanted;
    wanted.length = 0;
    // A ring past the view too: a chunk's instances overhang it (a tall building rises up the
    // screen into the next), and left as they are they would stack out of order with the pictures.
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const key = (x & 0xffff) * 65536 + (y & 0xffff);
        if (!this.members.has(key)) continue;
        const tile = this.tiles.get(key);
        if (!tile || (tile.dirty && now - tile.at >= REBAKE_MS)) wanted.push(key);
      }
    }
    if (!wanted.length) return true;
    // Missing pictures first (their buildings are live vector art, the costly kind), then stale ones.
    const missing = (key: number) => (this.tiles.get(key)?.sprite ? 1 : 0);
    wanted.sort((a, b) => missing(a) - missing(b) || near(a).d - near(b).d);
    withinFrame(this.options.budget ?? 4, (allowed) => {
      const started = performance.now();
      for (const key of wanted) {
        if (key !== wanted[0] && performance.now() - started >= allowed) break;
        this.bake(renderer, key, now);
      }
    });
    return true;
  }

  private bake(renderer: PIXI.Renderer, key: number, now: number) {
    const items = this.members.get(key);
    if (!items) return;
    const size = this.chunkSize;
    const pad = this.options.pad ?? 160;
    const res = this.options.resolution ?? Math.min(0.25, this.options.below * renderer.resolution);
    const { x, y } = { x: (key / 65536) << 16 >> 16, y: (key & 0xffff) << 16 >> 16 };
    // The chunk and `pad` round it, and as far as its instances reach past that (a tall building
    // rises up the screen well into the chunk behind): cut off, its top would be missing.
    let minX = x * size - pad, minY = y * size - pad, maxX = (x + 1) * size + pad, maxY = (y + 1) * size + pad;
    for (const item of items) {
      const b = item.bounds;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    const left = Math.floor(minX), top = Math.floor(minY);
    const width = Math.ceil((maxX - left) * res), height = Math.ceil((maxY - top) * res);
    let tile = this.tiles.get(key);
    if (!tile) this.tiles.set(key, (tile = { sprite: null, depth: null, dirty: true, tint: this.tint, baked: new Set(), at: 0, open: false, opening: false }));
    if (tile.sprite && (tile.sprite.texture.width !== width || tile.sprite.texture.height !== height)) {
      tile.sprite.destroy({ texture: true, baseTexture: true });
      tile.sprite = null;
    }
    if (!tile.sprite) {
      const texture = PIXI.RenderTexture.create({ width, height, resolution: 1 });
      tile.sprite = new PIXI.Sprite(texture);
      tile.sprite.scale.set(1 / res);
      tile.sprite.eventMode = "none";
      tile.sprite.zIndex = y;
      this.root.addChild(tile.sprite);
    }
    tile.sprite.position.set(left, top);
    const transform = new PIXI.Matrix(res, 0, 0, res, -left * res, -top * res);
    const renderTexture = tile.sprite.texture as PIXI.RenderTexture;
    let clear = true;
    // Under parts, then over parts, as the scene stacks them; hidden ones (culled, or covered by this
    // very picture) drawn all the same, and no depth occluders (a picture has no depth).
    const draw = (part: PIXI.Container, item: FarInstance) => {
      if (!part.children.length) return;
      const shown = part.visible;
      const alpha = part.alpha;
      const occluded = item.occluder?.visible ?? false;
      // Whole: a faded roof shows only while its chunk is open, not in the picture.
      part.visible = true;
      part.alpha = 1;
      if (item.occluder) item.occluder.visible = false;
      renderer.render(part, { renderTexture, clear, transform });
      clear = false;
      part.visible = shown;
      part.alpha = alpha;
      if (item.occluder) item.occluder.visible = occluded;
    };
    const ordered = [...items].sort((a, b) => a.over.zIndex - b.over.zIndex);
    for (const item of ordered) draw(item.under, item);
    for (const item of ordered) draw(item.over, item);
    if (clear) renderer.render(EMPTY, { renderTexture, clear });
    this.bakeDepth(tile, ordered);
    tile.dirty = false;
    tile.tint = this.tint;
    tile.at = now;
    tile.baked = new Set(ordered);
  }

  /**
   * The picture's instances' depth occluders as one mesh, over the picture: someone inside a
   * pictured building stays hidden under its roof, as with the instances themselves.
   */
  private bakeDepth(tile: Tile, items: FarInstance[]) {
    tile.depth?.destroy();
    tile.depth = null;
    const positions: number[] = [];
    const near: number[] = [];
    const indices: number[] = [];
    const top = this.root.parent;
    for (const item of items) {
      const occluder = item.occluder as PIXI.Mesh | null;
      if (!occluder?.geometry) continue;
      // The occluder's frame in the scene's (where the pictures are).
      const m = new PIXI.Matrix();
      for (let o: PIXI.DisplayObject | null = occluder; o && o !== top; o = o.parent) {
        o.transform.updateLocalTransform();
        m.prepend(o.transform.localTransform);
      }
      const p = occluder.geometry.getBuffer("aVertexPosition").data as Float32Array;
      const n = occluder.geometry.getBuffer("aNear").data as Float32Array;
      const base = positions.length / 2;
      for (let i = 0; i < p.length; i += 2) {
        positions.push(m.a * p[i] + m.c * p[i + 1] + m.tx, m.b * p[i] + m.d * p[i + 1] + m.ty);
        near.push(m.a * n[i] + m.c * n[i + 1] + m.tx, m.b * n[i] + m.d * n[i + 1] + m.ty);
      }
      const index = occluder.geometry.getIndex().data as Uint16Array;
      for (let i = 0; i < index.length; i++) indices.push(base + index[i]);
    }
    if (!positions.length) return;
    const depth = depthMesh(positions, near, indices);
    tile.depth = depth;
    this.root.addChild(depth);
  }

  clear() {
    for (const key of [...this.tiles.keys()]) this.drop(key);
    this.members.clear();
    this.keys.clear();
  }
}
