/**
 * ChunkStreamer decides each chunk's tier from the camera:
 *
 * - hot: in view plus `ring` chunks. Stepped every tick and snapshotted for drawing.
 * - warm: loaded and stepped on a stagger, with stats only. Chunks the game keeps warm
 *   (`keepWarm`) never go further; others stay warm while within `warmRing` of the view.
 * - cold: unloaded to bytes kept here, or never generated (generation is a pure function of the
 *   seed, so a chunk that was never touched needs no bytes).
 *
 * A chunk leaves a tier only once the view has moved `hysteresis` chunks past where it entered,
 * so a camera resting on a border doesn't thrash. At most `budget` chunks are generated or loaded
 * per update, nearest the view centre first.
 */
import { chunkKey, chunkX, chunkY } from "./coord";
import { Tier } from "./protocol";
import type { ChunkPool } from "./pool";

export type StreamerPool = Pick<ChunkPool, "chunks" | "generate" | "load" | "unload" | "setTier">;

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export type ChunkStreamerOptions = {
  chunkSize: number;
  /** Seed passed to `generate` for chunks that have never existed. */
  seed: number;
  /** Chunks around the view that are hot too. Default 1. */
  ring?: number;
  /** Chunks around the view that stay loaded (warm) for chunks that aren't kept warm. Default 3. */
  warmRing?: number;
  /** In chunks. Default 0.5. */
  hysteresis?: number;
  /** Chunks generated or loaded per update. Default 8. */
  budget?: number;
  /** Snapshot every this many ticks while hot (e.g. higher for remote hosts). Default 1. */
  snapshotEvery?: number;
  /** Whether a chunk exists at all (a bounded world returns false outside). Default: all do. */
  exists?: (cx: number, cy: number) => boolean;
  /** Chunks that stay loaded and warm wherever the camera is. Default: none. */
  keepWarm?: (cx: number, cy: number) => boolean;
  /** Called when a chunk turns hot, and when it stops being hot. */
  onHot?: (cx: number, cy: number) => void;
  onCool?: (cx: number, cy: number) => void;
};

const rectAround = (bounds: Bounds, size: number, ring: number) => ({
  x0: Math.floor(bounds.minX / size - ring),
  y0: Math.floor(bounds.minY / size - ring),
  x1: Math.floor(bounds.maxX / size + ring),
  y1: Math.floor(bounds.maxY / size + ring),
});

type Rect = ReturnType<typeof rectAround>;
const inside = (rect: Rect, cx: number, cy: number) => cx >= rect.x0 && cx <= rect.x1 && cy >= rect.y0 && cy <= rect.y1;

export class ChunkStreamer {
  readonly hot = new Set<number>();
  /** Serialized worlds of chunks that went cold. */
  readonly cold = new Map<number, Uint8Array>();
  /** Chunks being unloaded right now. */
  private readonly unloading = new Set<number>();
  private readonly options: Required<Omit<ChunkStreamerOptions, "onHot" | "onCool">> &
    Pick<ChunkStreamerOptions, "onHot" | "onCool">;

  constructor(
    readonly pool: StreamerPool,
    options: ChunkStreamerOptions
  ) {
    this.options = {
      ring: 1,
      warmRing: 3,
      hysteresis: 0.5,
      budget: 8,
      snapshotEvery: 1,
      exists: () => true,
      keepWarm: () => false,
      ...options,
    };
  }

  /** Changes the hot snapshot rate, applying it to every hot chunk. */
  setSnapshotEvery(every: number) {
    if (every === this.options.snapshotEvery) return;
    this.options.snapshotEvery = every;
    for (const key of this.hot) this.pool.setTier(chunkX(key), chunkY(key), Tier.Hot, every);
  }

  /** Whether a chunk is loaded or on its way. */
  private loaded(key: number) {
    return this.pool.chunks.has(key) && !this.unloading.has(key);
  }

  /** Makes a chunk loaded, within the budget. Returns false if the budget ran out. */
  private ensure(key: number, budget: { left: number }) {
    if (this.loaded(key)) return true;
    if (this.unloading.has(key) || budget.left <= 0) return false;
    budget.left--;
    const cx = chunkX(key);
    const cy = chunkY(key);
    const bytes = this.cold.get(key);
    if (bytes) {
      this.cold.delete(key);
      this.pool.load(cx, cy, bytes);
    } else {
      this.pool.generate(cx, cy, this.options.seed);
    }
    return true;
  }

  update(bounds: Bounds) {
    const { chunkSize, ring, warmRing, hysteresis, exists, keepWarm } = this.options;
    const enter = rectAround(bounds, chunkSize, ring);
    const stay = rectAround(bounds, chunkSize, ring + hysteresis);
    const centreX = (bounds.minX + bounds.maxX) / 2 / chunkSize - 0.5;
    const centreY = (bounds.minY + bounds.maxY) / 2 / chunkSize - 0.5;
    const budget = { left: this.options.budget };

    // Cool hot chunks the view has clearly left.
    for (const key of this.hot) {
      if (inside(stay, chunkX(key), chunkY(key))) continue;
      this.hot.delete(key);
      this.pool.setTier(chunkX(key), chunkY(key), Tier.Warm, 0);
      this.options.onCool?.(chunkX(key), chunkY(key));
    }

    // Heat chunks in view, nearest first, loading what's missing within the budget.
    const wanted: number[] = [];
    for (let cy = enter.y0; cy <= enter.y1; cy++) {
      for (let cx = enter.x0; cx <= enter.x1; cx++) {
        const key = chunkKey(cx, cy);
        if (!this.hot.has(key) && exists(cx, cy)) wanted.push(key);
      }
    }
    const distance = (key: number) => (chunkX(key) - centreX) ** 2 + (chunkY(key) - centreY) ** 2;
    wanted.sort((a, b) => distance(a) - distance(b));
    for (const key of wanted) {
      if (!this.ensure(key, budget)) continue;
      this.hot.add(key);
      this.pool.setTier(chunkX(key), chunkY(key), Tier.Hot, this.options.snapshotEvery);
      this.options.onHot?.(chunkX(key), chunkY(key));
    }

    // Unload chunks that are neither kept warm nor near the view.
    const warm = rectAround(bounds, chunkSize, warmRing + hysteresis);
    for (const [key, state] of this.pool.chunks) {
      if (this.hot.has(key) || this.unloading.has(key) || !state.ready) continue;
      if (keepWarm(state.cx, state.cy) || inside(warm, state.cx, state.cy)) continue;
      this.unloading.add(key);
      this.pool.unload(state.cx, state.cy).then(
        (bytes) => {
          this.unloading.delete(key);
          this.cold.set(key, bytes);
        },
        () => this.unloading.delete(key)
      );
    }
  }
}
