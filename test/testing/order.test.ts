import { SystemImpl } from "minecs";
import { describe, expect, test } from "vitest";
import { assertDrawsPerTick, assertRunOrder, countingRandom, drawsPerTick, runOrder } from "yage/testing/order";

class First extends SystemImpl { static depth = 1; }
class Second extends SystemImpl { static depth = 2; }
class AlsoSecond extends SystemImpl { static depth = 2; }

describe("order and draw assertions", () => {
  test("run order is depth, ties in list order", () => {
    expect(runOrder([Second, First, AlsoSecond])).toEqual([First, Second, AlsoSecond]);
    expect(() => assertRunOrder([First, Second, AlsoSecond])).not.toThrow();
    expect(() => assertRunOrder([Second, First], "sim")).toThrow("sim: listed Second (depth 2) at 0, but First (depth 1) runs there");
  });

  test("counts draws per tick and names the first tick that differs", () => {
    let seed = 1;
    const counter = countingRandom(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
    expect(drawsPerTick(counter, 3, (tick) => { for (let i = 0; i <= tick; i++) counter.random(); })).toEqual([1, 2, 3]);
    expect(counter.draws).toBe(6);
    expect(() => assertDrawsPerTick(counter, [2, 2], () => { counter.random(); counter.random(); })).not.toThrow();
    expect(() => assertDrawsPerTick(counter, [1, 1], (tick) => { counter.random(); if (tick) counter.random(); }, "chunk")).toThrow("chunk: tick 1 drew 2, expected 1");
  });
});
