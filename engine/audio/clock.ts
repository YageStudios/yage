/** Control-rate scheduling that works the same for live and offline contexts.
 *
 * Live contexts use wall-clock timers. Offline contexts have no wall clock, so
 * tasks are queued against audio time and run by `renderOffline()` (or any
 * caller) through `flush()` while the render is suspended at checkpoints.
 */
type Context = AudioContext | OfflineAudioContext;
type Task = { at: number; fn: () => void; live?: ReturnType<typeof setTimeout> };

export class Scheduler {
  readonly offline: boolean;
  private _ctx: Context;
  private _tasks = new Map<number, Task>();
  private _next = 1;

  constructor(ctx: Context) {
    this._ctx = ctx;
    this.offline = "startRendering" in ctx;
  }

  /** Run `fn` after `ms` milliseconds of audio (offline) or wall-clock (live) time. */
  set(fn: () => void, ms: number): number {
    const id = this._next++;
    const delay = Math.max(0, Number.isFinite(ms) ? ms : 0);
    const task: Task = { at: this._ctx.currentTime + Math.max(0.001, delay / 1000), fn };
    if (!this.offline) task.live = setTimeout(() => { if (this._tasks.delete(id)) fn(); }, delay);
    this._tasks.set(id, task);
    return id;
  }

  clear(id: number): void {
    const task = this._tasks.get(id);
    if (!task) return;
    if (task.live !== undefined) clearTimeout(task.live);
    this._tasks.delete(id);
  }

  /** Offline only: run every task due by the context's current time, in order. */
  flush(limit = 100_000): number {
    let ran = 0;
    for (;;) {
      const now = this._ctx.currentTime + 1e-9;
      let best: [number, Task] | undefined;
      for (const entry of this._tasks) if (entry[1].at <= now && (!best || entry[1].at < best[1].at)) best = entry;
      if (!best) return ran;
      this._tasks.delete(best[0]);
      if (best[1].live !== undefined) clearTimeout(best[1].live);
      best[1].fn();
      if (++ran > limit) throw new Error("bleep-bloop: runaway scheduler (task keeps rescheduling itself immediately)");
    }
  }

  /** Earliest pending task time, or Infinity. */
  get nextAt(): number {
    let at = Infinity;
    for (const task of this._tasks.values()) at = Math.min(at, task.at);
    return at;
  }

  get pending(): number { return this._tasks.size; }

  clearAll(): void { for (const id of [...this._tasks.keys()]) this.clear(id); }
}
