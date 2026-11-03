/**
 * Far-off static instances as one picture a chunk (ChunkScene's `farBake`).
 *
 * Zoomed far out a city's buildings are thousands of containers and hundreds of thousands of
 * vector shapes, each re-batched every frame for a building a few pixels wide. Below `below` zoom
 * each chunk is rendered once into a texture of its own and drawn as one sprite: exactly the chunk,
 * cut at its edges, with every instance that reaches into it (`pad` past its bounds, for what draws
 * past them) stacked as the scene stacks them, under parts then over parts by depth. Pictures never
 * overlap, so none stacks wrongly against another, and they draw over every static instance: an
 * instance shown as it is under a picture is drawn there by the picture just the same. An instance
 * is hidden (StaticSet.cull) while every chunk it reaches has a picture with it in. A chunk without
 * a picture yet shows its instances as they are, so nothing goes blank while pictures are made:
 * nearest the view's centre first, within the frame's shared budget (yage/game/FrameBudget), at
 * least one a frame. Pictures are made at the screen's density (halving down from `resolution` as the
 * zoom does), all of them within a byte budget, and kept a few seconds after the zoom leaves their range.
 *
 * A chunk's picture is made again when an instance reaching it is added, built or dropped, when the
 * display tree under one changes (a child added or removed anywhere in it), or when the scene's
 * light tint moves on by more than TINT_STEP a channel: after the view's missing pictures, and no
 * sooner than REBAKE_MS after it was last made. Until then a chunk an instance built, changed or
 * dropped since reaches shows as it is in place of its picture (which would draw the instance as it
 * was, or not at all, under or over its neighbours), as does one while an instance's over part in
 * it is faded (a roof someone is inside): the inside stacks with the walls around it as the scene
 * does. Other in-place changes are not seen (a light's tint, until it moves on enough): from that far they don't show.
 */
import * as PIXI from "pixi.js";
import { withinFrame } from "../game/FrameBudget";
import { depthMesh } from "./statics";
import type { Rect } from "./vector";
import { chunkKey, chunkX, chunkY } from "./coord";

export type FarBakeOptions = {
  /** Zoom (screen px per world unit) under which chunks show their pictures. */
  below: number;
  /**
   * The most texture px per world unit a picture gets (default `below` times the renderer's
   * resolution, at most 0.25). Pictures are made at the screen's own density under it, halving as the
   * zoom does (see `level`), so a wide view holds many small pictures rather than many full ones.
   */
  resolution?: number;
  /** Bytes the pictures may hold in all (default 192 MiB): the view's ring gets coarser to fit, and pictures off it go first. */
  bytes?: number;
  /** World units past its bounds an instance may draw (a shadow, an awning): the chunks that far take it into their pictures (default 160). */
  pad?: number;
  /** Milliseconds a frame may spend making pictures, from the frame's shared budget (default 4). */
  budget?: number;
};

/** What a picture is made of: an instance's parts, as StaticSet holds them. */
export type FarInstance = { under: PIXI.Container; over: PIXI.Container; occluder: PIXI.DisplayObject | null; bounds: Rect };

type Tile = {
  sprite: PIXI.Sprite | null;
  depth: PIXI.Mesh<PIXI.Shader> | null;
  dirty: boolean;
  tint: number;
  /** Texture px per world unit it was made at. */
  res: number;
  /** An instance reaching it was added, built, changed or dropped since its depth mesh (made again only then: a tint or resolution alone leaves it). */
  reshaped: boolean;
  baked: Set<FarInstance>;
  at: number;
  /** Showing as it is this frame (`changed` or `opening`). */
  open: boolean;
  /** An instance reaching it was built, changed or dropped since its picture. */
  changed: boolean;
  /** An instance in it was seen faded last frame. */
  faded: boolean;
  /** An instance in it was seen faded this frame. */
  opening: boolean;
};

const EMPTY = new PIXI.Container();
/** Channels further apart than this make a picture stale. */
const TINT_STEP = 6;
/** Milliseconds a stale picture keeps showing before it is made again (pictures yet to be made come first). */
const REBAKE_MS = 500;
/** Out of zoom's way: pictures stay on until the zoom passes `below` by this much. */
const HYSTERESIS = 1.1;
/** A picture made at more than this many times the screen's density is made again smaller (one level of zoom out is kept: 2× wouldn't be). */
const OVER_RES = 4;
/** Milliseconds pictures are kept (hidden) after the zoom passes out of their range, so wheeling back and forth over it doesn't make them all again. */
const WARM_MS = 4000;

const tintFar = (a: number, b: number) => {
  for (let shift = 0; shift <= 16; shift += 8) if (Math.abs(((a >> shift) & 255) - ((b >> shift) & 255)) > TINT_STEP) return true;
  return false;
};

export class FarBake {
  /** The pictures, where the scene's static roots are. */
  readonly root = new PIXI.Container();
  active = false;
  private readonly tiles = new Map<number, Tile>();
  /** Each chunk's instances: those reaching it. */
  private readonly members = new Map<number, Set<FarInstance>>();
  /** The chunks each instance reaches. */
  private readonly keys = new Map<FarInstance, number[]>();
  private readonly watched = new WeakSet<PIXI.Container>();
  private tint = 0xffffff;
  private readonly wanted: number[] = [];

  constructor(
    private readonly chunkSize: number,
    private readonly options: FarBakeOptions,
  ) {
    this.root.eventMode = "none";
    this.root.visible = false;
  }

  /** The chunks `item` reaches, `pad` past its bounds. */
  private keysOf(b: Rect) {
    const size = this.chunkSize;
    const pad = this.options.pad ?? 160;
    const keys: number[] = [];
    for (let cy = Math.floor((b.minY - pad) / size); cy <= Math.floor((b.maxY + pad) / size); cy++) {
      for (let cx = Math.floor((b.minX - pad) / size); cx <= Math.floor((b.maxX + pad) / size); cx++) keys.push(chunkKey(cx, cy));
    }
    return keys;
  }

  /** `item` is in no picture as it is now: the chunks it reaches are stale, and show as they are until made again. */
  private stale(item: FarInstance, keys: number[]) {
    for (const key of keys) {
      const tile = this.tiles.get(key);
      if (!tile) continue;
      tile.dirty = true;
      tile.reshaped = true;
      // An instance with nothing built is in no picture and shows nothing as it is: nothing to show differently.
      if (tile.baked.delete(item) || item.under.children.length || item.over.children.length) tile.changed = true;
    }
  }

  /** An instance listed: the pictures of the chunks it reaches are stale. */
  add(item: FarInstance) {
    const keys = this.keysOf(item.bounds);
    this.keys.set(item, keys);
    for (const key of keys) {
      let set = this.members.get(key);
      if (!set) this.members.set(key, (set = new Set()));
      set.add(item);
    }
    this.stale(item, keys);
  }

  /** An instance dropped. */
  remove(item: FarInstance) {
    const keys = this.keys.get(item);
    if (!keys) return;
    this.keys.delete(item);
    this.stale(item, keys);
    for (const key of keys) {
      const set = this.members.get(key);
      set?.delete(item);
      if (set && !set.size) {
        this.members.delete(key);
        this.drop(key);
      }
    }
  }

  /** An instance built (or changed): the pictures it reaches are stale, and so they will be at every later change under it. */
  changed(item: FarInstance) {
    const keys = this.keys.get(item);
    if (keys) this.stale(item, keys);
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
    const keys = this.keys.get(item);
    if (!keys) return false;
    let covered = true;
    for (const key of keys) {
      const tile = this.tiles.get(key);
      // Faded, the chunks it reaches show as they are (from the next frame), so its inside stacks with its walls.
      if (tile && item.over.alpha < 1) tile.opening = true;
      if (!tile?.sprite || !tile.sprite.visible || !tile.baked.has(item)) covered = false;
    }
    return covered;
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
        this.offAt = now;
      }
      if (this.tiles.size && now - this.offAt >= WARM_MS) for (const key of [...this.tiles.keys()]) this.drop(key);
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
      const x = chunkX(key), y = chunkY(key);
      return { x, y, d: (x - cx) ** 2 + (y - cy) ** 2 };
    };
    const res = (this.res = this.level(renderer, zoom, (x1 - x0 + 3) * (y1 - y0 + 3)));
    const want = zoom * renderer.resolution;
    for (const [key, tile] of this.tiles) {
      const { x, y } = near(key);
      if (x < x0 - 2 || x > x1 + 2 || y < y0 - 2 || y > y1 + 2) this.drop(key);
      else {
        // Blurry for this zoom, or far finer than it needs (and the budget allows): made again at `res`, shown as it is meanwhile.
        if (!tile.dirty && tile.res !== res && (tile.res < Math.min(res, want / HYSTERESIS) || tile.res > Math.max(res, want * OVER_RES))) tile.dirty = true;
        const near = x >= x0 - 1 && x <= x1 + 1 && y >= y0 - 1 && y <= y1 + 1;
        tile.faded = tile.opening;
        tile.open = tile.faded || tile.changed;
        tile.opening = false;
        if (tile.sprite) tile.sprite.visible = near && !tile.open;
        if (tile.depth) tile.depth.visible = near && !tile.open;
        if (!tile.dirty && tintFar(tile.tint, this.tint)) tile.dirty = true;
      }
    }
    this.evict(near, x0, x1, y0, y1);
    const wanted = this.wanted;
    wanted.length = 0;
    // A ring past the view too: a chunk's instances overhang it (a tall building rises up the
    // screen into the next), and left as they are they would stack out of order with the pictures.
    for (let y = y0 - 1; y <= y1 + 1; y++) {
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        const key = chunkKey(x, y);
        if (!this.members.has(key)) continue;
        const tile = this.tiles.get(key);
        if (!tile || (tile.dirty && now - tile.at >= REBAKE_MS)) wanted.push(key);
      }
    }
    if (!wanted.length) return true;
    // Missing pictures first (their buildings are live vector art, the costly kind), then stale ones.
    const missing = (key: number) => (this.tiles.get(key)?.sprite ? 1 : 0);
    wanted.sort((a, b) => missing(a) - missing(b) || near(a).d - near(b).d);
    // Shared with the frame's other deferrable work; with nothing left, a bake waits for the frame's
    // one floor (FrameBudget.frameFloor) rather than always taking a picture's worth.
    withinFrame(this.options.budget ?? 4, (allowed) => {
      if (allowed <= 0) return;
      const started = performance.now();
      for (const key of wanted) {
        if (key !== wanted[0] && performance.now() - started >= allowed) break;
        this.bake(renderer, key, now);
      }
    }, "far-bake", 1e-3);
    return true;
  }

  /** The resolution pictures are made at now. */
  private res = 0;
  /** When the pictures were last turned off (they go WARM_MS after). */
  private offAt = 0;

  /**
   * Texture px per world unit for pictures at `zoom`: the top resolution halved while half still
   * meets the screen's density, and coarser again until `ring` chunks' pictures fit the byte budget.
   */
  private level(renderer: PIXI.Renderer, zoom: number, ring: number) {
    const top = this.options.resolution ?? Math.min(0.25, this.options.below * renderer.resolution);
    const want = zoom * renderer.resolution;
    const fits = Math.sqrt((this.options.bytes ?? 192 * 1048576) / (ring * 4)) / this.chunkSize;
    let res = top;
    while ((res / 2 >= want || res > fits) && res * this.chunkSize >= 32) res /= 2;
    return res;
  }

  /** Past the byte budget, drops the pictures furthest from the view's centre that are off its ring. */
  private evict(near: (key: number) => { x: number; y: number; d: number }, x0: number, x1: number, y0: number, y1: number) {
    const budget = this.options.bytes ?? 192 * 1048576;
    let bytes = 0;
    const off: number[] = [];
    for (const [key, tile] of this.tiles) {
      if (!tile.sprite) continue;
      bytes += tile.sprite.texture.width * tile.sprite.texture.height * 4;
      const { x, y } = near(key);
      if (x < x0 - 1 || x > x1 + 1 || y < y0 - 1 || y > y1 + 1) off.push(key);
    }
    if (bytes <= budget) return;
    off.sort((a, b) => near(b).d - near(a).d);
    for (const key of off) {
      if (bytes <= budget) break;
      const texture = this.tiles.get(key)!.sprite!.texture;
      bytes -= texture.width * texture.height * 4;
      this.drop(key);
    }
  }

  /** Bytes the pictures hold now. */
  get bytes() {
    let bytes = 0;
    for (const tile of this.tiles.values()) if (tile.sprite) bytes += tile.sprite.texture.width * tile.sprite.texture.height * 4;
    return bytes;
  }

  private bake(renderer: PIXI.Renderer, key: number, now: number) {
    const items = this.members.get(key);
    if (!items) return;
    const size = this.chunkSize;
    const res = this.res || this.level(renderer, this.options.below, 9);
    const { x, y } = { x: chunkX(key), y: chunkY(key) };
    // Exactly the chunk: what reaches past it is drawn by the next chunk's picture, stacked there with what is in front of it.
    const left = x * size, top = y * size;
    const width = Math.ceil(size * res), height = width;
    let tile = this.tiles.get(key);
    if (!tile) this.tiles.set(key, (tile = { sprite: null, depth: null, dirty: true, tint: this.tint, res, reshaped: true, baked: new Set(), at: 0, open: false, changed: false, faded: false, opening: false }));
    if (tile.sprite && (tile.sprite.texture.width !== width || tile.sprite.texture.height !== height)) {
      tile.sprite.destroy({ texture: true, baseTexture: true });
      tile.sprite = null;
    }
    if (!tile.sprite) {
      const texture = PIXI.RenderTexture.create({ width, height, resolution: 1 });
      tile.sprite = new PIXI.Sprite(texture);
      tile.sprite.eventMode = "none";
      this.root.addChild(tile.sprite);
    }
    tile.sprite.scale.set(size / width);
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
    // In the scene's order: under parts as listed, over parts by depth (ties as listed).
    const listed = [...items];
    const ordered = listed.map((item, i) => ({ item, i })).sort((a, b) => a.item.over.zIndex - b.item.over.zIndex || a.i - b.i).map((o) => o.item);
    for (const item of listed) draw(item.under, item);
    for (const item of ordered) draw(item.over, item);
    if (clear) renderer.render(EMPTY, { renderTexture, clear });
    // Each instance's occluder once, with the chunk it stands in (its bounds' centre).
    const home = (item: FarInstance) => Math.floor((item.bounds.minX + item.bounds.maxX) / 2 / size) === x && Math.floor((item.bounds.minY + item.bounds.maxY) / 2 / size) === y;
    if (tile.reshaped) this.bakeDepth(tile, ordered.filter(home));
    tile.reshaped = false;
    tile.dirty = false;
    tile.changed = false;
    // Shown from this frame (it is in the view's ring), unless faded.
    tile.open = tile.faded;
    tile.sprite.visible = !tile.open;
    if (tile.depth) tile.depth.visible = !tile.open;
    tile.tint = this.tint;
    tile.res = res;
    tile.at = now;
    // An instance with nothing built yet isn't in the picture: built, it shows as it is until the next.
    tile.baked = new Set(ordered.filter((item) => item.under.children.length || item.over.children.length));
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
