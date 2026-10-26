/**
 * Which chunks step hot, from any number of foci: each player's view, or anything else a game wants
 * simulated closely. A chunk is hot while it is within some focus's bounds plus its `ring`, and stays
 * hot until every focus has moved `hysteresis` chunks past it, so a view resting on a border doesn't
 * thrash. Pure bookkeeping over chunk keys: the run's owner feeds it the foci it holds and stamps
 * what changes (ChunkPool.setSimTier) on its own steps, so the hot set is the same whoever watches
 * and however frames fall, and a server can run as many hot areas as it has players.
 */
import { chunkX, chunkY, keySpace, spaceChunkKey } from "./coord";

/** A focus, in chunks (fractional): the area it simulates closely, and the ring of chunks around it. */
export type HotFocus = { space?: number; minX: number; minY: number; maxX: number; maxY: number; ring?: number };

export type HotSetOptions = {
  /** In chunks. Default 0.5. */
  hysteresis?: number;
  /** Whether a chunk can step hot at all (e.g. only the simulated region). Default: all. */
  exists?: (space: number, cx: number, cy: number) => boolean;
};

const rectOf = (f: HotFocus, pad: number) => ({
  x0: Math.floor(f.minX - pad),
  y0: Math.floor(f.minY - pad),
  x1: Math.floor(f.maxX + pad),
  y1: Math.floor(f.maxY + pad),
});

export class HotSet {
  readonly hot = new Set<number>();
  private readonly hysteresis: number;
  private readonly exists: (space: number, cx: number, cy: number) => boolean;

  constructor(options: HotSetOptions = {}) {
    this.hysteresis = options.hysteresis ?? 0.5;
    this.exists = options.exists ?? (() => true);
  }

  /** The chunks that turn hot and that cool for these foci, each in key order. */
  update(foci: readonly HotFocus[]): { heat: number[]; cool: number[] } {
    const cool: number[] = [];
    for (const key of this.hot) {
      const cx = chunkX(key);
      const cy = chunkY(key);
      const kept = foci.some((f) => {
        if ((f.space ?? 0) !== keySpace(key)) return false;
        const r = rectOf(f, (f.ring ?? 1) + this.hysteresis);
        return cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1;
      });
      if (!kept) cool.push(key);
    }
    for (const key of cool) this.hot.delete(key);
    const heat: number[] = [];
    for (const f of foci) {
      const space = f.space ?? 0;
      const r = rectOf(f, f.ring ?? 1);
      for (let cy = r.y0; cy <= r.y1; cy++)
        for (let cx = r.x0; cx <= r.x1; cx++) {
          const key = spaceChunkKey(space, cx, cy);
          if (this.hot.has(key) || !this.exists(space, cx, cy)) continue;
          this.hot.add(key);
          heat.push(key);
        }
    }
    const order = (a: number, b: number) => a - b;
    return { heat: heat.sort(order), cool: cool.sort(order) };
  }
}
