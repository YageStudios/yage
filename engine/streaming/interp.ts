/**
 * Keeps the last two snapshots of a chunk so a renderer can draw between them.
 *
 * Snapshot arrays are indexed by entity slot. When a slot holds a different entity than in the
 * previous snapshot (a removed id was reused), its previous position is replaced by the new one,
 * so the new entity appears in place instead of sliding across the chunk.
 */
import { EMPTY_SLOT, type Snapshot } from "./protocol";

export class SnapshotPair {
  current: Snapshot | null = null;
  /** Previous positions, aligned to `current` (length ≥ current.count). */
  prevX = new Int16Array(0);
  prevY = new Int16Array(0);
  /** When the current snapshot arrived, and the smoothed interval between arrivals (ms). */
  receivedAt = 0;
  interval: number;

  constructor(expectedInterval = 50) {
    this.interval = expectedInterval;
  }

  push(next: Snapshot, now: number) {
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
      const elapsed = now - this.receivedAt;
      if (elapsed > 0 && elapsed < 2000) this.interval += (elapsed - this.interval) * 0.2;
    }
    this.current = next;
    this.receivedAt = now;
  }

  /** 0 at the moment the current snapshot arrived, 1 one interval later. */
  alpha(now: number) {
    if (!this.current) return 1;
    return Math.min(1, Math.max(0, (now - this.receivedAt) / Math.max(1, this.interval)));
  }
}
