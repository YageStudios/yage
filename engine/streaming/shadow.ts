/**
 * Shadow islands: a viewer's own chunks, simulated for show beside a run (a replay's, a spectator's)
 * that they can never write back to. An island is one shadow host (ChunkHost `shadow`, in the
 * viewer's own worker or in-process) behind its own pool, in lockstep with nobody but itself: it
 * starts at the run's tick and is let run up to wherever the run is (`follow`), never past it. Its
 * chunks open from the run's (a peek, ChunkPool.peek: nothing waits and nothing changes) or from
 * the seed, and people walking out of the island leave it, to the driver (`exited`). Its stats,
 * locates and posts stay inside it. Dropped when the viewer goes; rebuilt at the run's tick when
 * they come back, so nothing needs its history.
 */
import { spaceChunkKey } from "./coord";
import type { ExitedMessage } from "./protocol";
import { Tier } from "./protocol";
import { ChunkPool, type ChunkPoolEvents } from "./pool";
import type { ChunkTransport } from "./transport";

export type ShadowIslandOptions = {
  /** The run's lockstep lead (hand-offs inside the island land this many ticks on). */
  lead: number;
  /** The run's tick the island starts at. */
  tick: number;
  /** Events off the island's own pool (its snapshots, overlays, stats), for whoever draws it. */
  events?: ChunkPoolEvents;
  /** People who walked out of the island (gone from it). */
  exited?: (exit: ExitedMessage) => void;
};

export class ShadowIsland {
  readonly pool: ChunkPool;
  /** The island's chunks, by key. */
  readonly chunks = new Set<number>();

  constructor(transport: ChunkTransport, options: ShadowIslandOptions) {
    this.pool = new ChunkPool(() => 0);
    this.pool.setLockstep(Math.max(1, options.lead));
    this.pool.on({ ...options.events, exited: (exit) => options.exited?.(exit) });
    this.pool.addHost(transport, "local");
    if (options.tick > 0) this.pool.resume(options.tick);
  }

  /** How far the island has been let run: the first tick it may not run yet. */
  get tick() {
    return this.pool.limit;
  }

  /**
   * Opens chunk (cx, cy) in the island at its next tick: from a run chunk's bytes (a peek), else
   * generated from `seed` (with `init`, as the module's generate takes it). Steps hot if `hot`.
   */
  open(cx: number, cy: number, from: { bytes: Uint8Array } | { seed: number; init?: Uint8Array }, hot = false, space = 0) {
    const key = spaceChunkKey(space, cx, cy);
    if (this.chunks.has(key)) return;
    this.chunks.add(key);
    if ("bytes" in from) this.pool.load(cx, cy, from.bytes, 0, space);
    else this.pool.generate(cx, cy, from.seed, 0, space, from.init);
    if (hot) this.pool.setSimTier(cx, cy, Tier.Hot, space);
  }

  /** Closes chunk (cx, cy): it goes from the island at its next tick, with whoever is in it. */
  close(cx: number, cy: number, space = 0) {
    const key = spaceChunkKey(space, cx, cy);
    if (!this.chunks.delete(key)) return;
    void this.pool.unload(cx, cy, space);
  }

  /** Lets the island run up to the run's `tick` (never back). */
  follow(tick: number) {
    this.pool.setLimit(tick);
  }

  destroy() {
    this.pool.destroy();
    this.chunks.clear();
  }
}
