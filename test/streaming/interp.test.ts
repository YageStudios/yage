import { describe, expect, test } from "vitest";
import { SnapshotPair } from "yage/streaming/interp";
import { createSnapshot, EMPTY_SLOT } from "yage/streaming/protocol";

const snap = (tick: number, rows: [gid: number, x: number, tint?: number][]) => {
  const s = createSnapshot(0, 0, tick, rows.length);
  rows.forEach(([gid, x, tint = 1], i) => {
    s.gid[i] = gid;
    s.x[i] = x;
    s.y[i] = x;
    s.tint[i] = tint;
  });
  return s;
};

describe("SnapshotPair", () => {
  test("interpolates from the previous position of the same entity", () => {
    const pair = new SnapshotPair(100);
    pair.push(snap(0, [[1, 10]]), 0);
    expect([...pair.prevX]).toEqual([10]);
    pair.push(snap(1, [[1, 20]]), 100);
    pair.advance(Infinity);
    expect(pair.current!.tick).toBe(1);
    expect(pair.prevX[0]).toBe(10);
  });

  test("snaps reused slots, new slots and previously empty slots instead of sliding", () => {
    const pair = new SnapshotPair(100);
    pair.push(snap(0, [[1, 10], [2, 10, EMPTY_SLOT]]), 0);
    pair.push(snap(1, [[3, 50], [2, 60], [4, 70]]), 100);
    pair.advance(Infinity);
    expect([...pair.prevX.subarray(0, 3)]).toEqual([50, 60, 70]);
  });

  test("smooths the arrival interval", () => {
    const pair = new SnapshotPair(100);
    pair.push(snap(0, [[1, 0]]), 0);
    pair.push(snap(1, [[1, 0]]), 200);
    expect(pair.interval).toBe(120);
  });

  test("plays bursty arrivals out on a steady clock, each snapshot drawn in turn", () => {
    // One tick per 10 ms, arriving in pairs every 20 ms (the second of each pair one tick late).
    const pair = new SnapshotPair(10);
    pair.push(snap(0, [[1, 0]]), 0);
    const drawn: number[] = [];
    let tick = 1;
    for (let now = 5; now <= 400; now += 5) {
      if (now % 20 === 0) for (const t of [tick++, tick++]) pair.push(snap(t, [[1, t * 10]]), now);
      pair.advance(now);
      if (now >= 100) drawn.push(pair.prevTick + (pair.current!.tick - pair.prevTick) * pair.alpha(now));
    }
    // Every frame moves the drawn tick on by the frame's time (half a tick), none stalls or jumps.
    for (let i = 1; i < drawn.length; i++) expect(drawn[i] - drawn[i - 1]).toBeCloseTo(0.5, 5);
    // And no further behind the newest than the gap and the jitter call for.
    expect(tick - 1 - drawn[drawn.length - 1]).toBeLessThan(4);
  });

  test("holds at the newest snapshot when arrivals stop, then follows the stream again", () => {
    const pair = new SnapshotPair(10);
    for (let t = 0; t <= 10; t++) pair.push(snap(t, [[1, t]]), t * 10);
    pair.advance(1000);
    expect(pair.current!.tick).toBe(10);
    expect(pair.alpha(1000)).toBe(1);
    // Resumed after the pause: drawn from the new arrivals, close behind them.
    for (let t = 11; t <= 20; t++) pair.push(snap(t, [[1, t]]), 2000 + (t - 11) * 10);
    pair.advance(2090);
    expect(pair.current!.tick).toBeGreaterThanOrEqual(18);
  });

  test("shows a stale or repeated tick at once", () => {
    const pair = new SnapshotPair(10);
    pair.push(snap(5, [[1, 5]]), 0);
    pair.push(snap(6, [[1, 6]]), 10);
    pair.push(snap(2, [[1, 2]]), 20);
    expect(pair.current!.tick).toBe(2);
    expect(pair.queue).toHaveLength(0);
    expect(pair.alpha(20)).toBe(1);
  });

  test("bounds the queue during a render stall, applying the oldest", () => {
    const pair = new SnapshotPair(100);
    pair.push(snap(0, [[1, 0]]), 0);
    for (let tick = 1; tick <= 100; tick++) pair.push(snap(tick, [[1, tick]]), 0);
    expect(pair.queue.length).toBe(32);
    expect(pair.current!.tick).toBe(68);
    pair.advance(Infinity);
    expect(pair.current!.tick).toBe(100);
  });
});
