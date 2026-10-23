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
    expect(pair.prevX[0]).toBe(10);
    expect(pair.alpha(150)).toBe(0.5);
    expect(pair.alpha(500)).toBe(1);
  });

  test("snaps reused slots, new slots and previously empty slots instead of sliding", () => {
    const pair = new SnapshotPair(100);
    pair.push(snap(0, [[1, 10], [2, 10, EMPTY_SLOT]]), 0);
    pair.push(snap(1, [[3, 50], [2, 60], [4, 70]]), 100);
    expect([...pair.prevX.subarray(0, 3)]).toEqual([50, 60, 70]);
  });

  test("smooths the arrival interval", () => {
    const pair = new SnapshotPair(100);
    pair.push(snap(0, [[1, 0]]), 0);
    pair.push(snap(1, [[1, 0]]), 200);
    expect(pair.interval).toBe(120);
  });
});
