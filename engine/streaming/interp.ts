/**
 * A chunk's snapshots, played out on a steady clock so a renderer can draw between them.
 *
 * Snapshots arrive in bursts (a worker posts several in one task, a frame stalls), so drawing
 * from "the last one that arrived" makes entities stall and jump and lets what happens on one
 * tick (a death) show a frame early or never. Instead arrivals queue, and the drawn tick runs at
 * the sim's rate a little behind the newest arrival: far enough to cover the gap to the next
 * snapshot plus the arrivals' jitter. `advance` releases the queued snapshots the drawn tick has
 * reached; `current` is the first at or past it and `alpha` how far the drawn tick is from the one
 * before. A stale or repeated tick (the stream restarting, a frame-made snapshot) applies at once.
 *
 * Snapshot arrays are indexed by entity slot. When a slot holds a different entity than in the
 * previous snapshot (a removed id was reused), its previous position is replaced by the new one,
 * so the new entity appears in place instead of sliding across the chunk.
 */
import { EMPTY_SLOT, type Snapshot } from "./protocol";

/** Ticks behind the newest arrival kept besides the gap and the measured jitter. */
const MARGIN = 0.5;

/** Snapshots kept waiting for the drawn tick before the oldest are applied regardless. */
const QUEUE_LIMIT = 32;

export class SnapshotPair {
  current: Snapshot | null = null;
  /** Previous positions, aligned to `current` (length ≥ current.count). */
  prevX = new Int16Array(0);
  prevY = new Int16Array(0);
  /** The tick of the snapshot before `current` (its own tick when there is none). */
  prevTick = 0;
  /** When the newest snapshot arrived, and the smoothed interval between arrivals (ms). */
  receivedAt = 0;
  interval: number;
  /** Arrived and not yet reached by the drawn tick, oldest first. */
  readonly queue: Snapshot[] = [];
  /** Bumped whenever `current` changes. */
  version = 0;
  /** Milliseconds per sim tick. */
  private readonly tickMs: number;
  private newest = 0;
  private gap = 1;
  /** Sim tick at time 0 by the earliest arrivals, and how late arrivals run past it (ticks). */
  private origin = 0;
  private jitter = 0;
  private drawn = 0;

  constructor(expectedInterval = 50, tickInterval = expectedInterval) {
    this.interval = expectedInterval;
    this.tickMs = Math.max(1e-3, tickInterval);
  }

  push(next: Snapshot, now: number) {
    if (this.current) {
      const elapsed = now - this.receivedAt;
      if (elapsed > 0 && elapsed < 2000) this.interval += (elapsed - this.interval) * 0.2;
    }
    this.receivedAt = now;
    const sample = next.tick - now / this.tickMs;
    if (!this.current || next.tick <= this.newest) {
      // First, repeated or stale: show it now and start the clock again from it.
      this.queue.length = 0;
      this.apply(next);
      this.newest = this.drawn = next.tick;
      this.origin = sample;
      this.jitter = 0;
      return;
    }
    this.gap = next.tick - this.newest;
    this.newest = next.tick;
    this.queue.push(next);
    // A render stall must not grow a long stale tail: past the bound, the oldest are reached at once.
    while (this.queue.length > QUEUE_LIMIT) this.apply(this.queue.shift()!);
    const late = this.origin - sample;
    // Earlier than ever (or long late: a pause, a stall): the clock follows at once.
    if (late < 0 || late > this.gap + 250 / this.tickMs) {
      this.origin = sample;
      this.jitter = 0;
    } else {
      this.origin -= late * 0.02;
      this.jitter += (late - this.jitter) * 0.1;
    }
  }

  /** The tick drawn at `now`: steady, never past the newest arrival, never back. */
  tickAt(now: number) {
    if (!Number.isFinite(now)) return this.newest;
    const target = now / this.tickMs + this.origin - this.gap - 2 * this.jitter - MARGIN;
    return Math.min(this.newest, Math.max(this.drawn, target));
  }

  /** Moves the drawn tick to `now`, releasing the snapshots it reached; true if `current` changed. */
  advance(now: number) {
    const before = this.version;
    this.drawn = this.tickAt(now);
    while (this.queue.length && this.current!.tick < this.drawn) this.apply(this.queue.shift()!);
    return this.version !== before;
  }

  /** 0 at the previous snapshot's tick, 1 at the current one's, by the drawn tick at `now`. */
  alpha(now: number) {
    if (!this.current) return 1;
    const span = this.current.tick - this.prevTick;
    if (span <= 0) return 1;
    return Math.min(1, Math.max(0, (this.tickAt(now) - this.prevTick) / span));
  }

  private apply(next: Snapshot) {
    const count = next.count;
    if (this.prevX.length < count) {
      const capacity = Math.max(count, Math.ceil(this.prevX.length * 1.5));
      this.prevX = new Int16Array(capacity);
      this.prevY = new Int16Array(capacity);
    }
    const prev = this.current;
    if (!prev) {
      this.prevX.set(next.x);
      this.prevY.set(next.y);
    } else {
      const shared = Math.min(prev.count, count);
      const { gid, x, y, tint } = next;
      for (let i = 0; i < shared; i++) {
        const same = prev.gid[i] === gid[i] && prev.tint[i] !== EMPTY_SLOT && tint[i] !== EMPTY_SLOT;
        this.prevX[i] = same ? prev.x[i] : x[i];
        this.prevY[i] = same ? prev.y[i] : y[i];
      }
      for (let i = shared; i < count; i++) {
        this.prevX[i] = x[i];
        this.prevY[i] = y[i];
      }
    }
    this.prevTick = prev ? prev.tick : next.tick;
    this.current = next;
    this.version++;
  }
}
