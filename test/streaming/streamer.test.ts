import { describe, expect, test } from "vitest";
import { chunkKey } from "yage/streaming/coord";
import { Tier } from "yage/streaming/protocol";
import { ChunkStreamer, type StreamerPool } from "yage/streaming/streamer";
import type { ChunkState } from "yage/streaming/pool";

const SIZE = 100;

/** Records what the streamer asks for; unloads resolve when `settle` is called. */
const fakePool = () => {
  const chunks = new Map<number, ChunkState>();
  const log: string[] = [];
  const pendingUnloads: (() => void)[] = [];
  const add = (cx: number, cy: number) => {
    const state: ChunkState = { space: 0, cx, cy, host: 0, ready: true, population: 1, tier: Tier.Warm, snapshotEvery: 0, moving: false };
    chunks.set(chunkKey(cx, cy), state);
    return state;
  };
  const pool: StreamerPool = {
    chunks,
    generate(cx, cy) {
      log.push(`generate ${cx},${cy}`);
      return add(cx, cy);
    },
    load(cx, cy, bytes) {
      log.push(`load ${cx},${cy} [${[...bytes]}]`);
      return add(cx, cy);
    },
    unload(cx, cy) {
      log.push(`unload ${cx},${cy}`);
      return new Promise((resolve) =>
        pendingUnloads.push(() => {
          chunks.delete(chunkKey(cx, cy));
          resolve(new Uint8Array([cx, cy]));
        })
      );
    },
    setTier(cx, cy, tier, every = 1) {
      const state = chunks.get(chunkKey(cx, cy))!;
      state.tier = tier;
      state.snapshotEvery = every;
      log.push(`${tier === Tier.Hot ? "hot" : "warm"} ${cx},${cy}`);
    },
  };
  const settle = async () => {
    for (const resolve of pendingUnloads.splice(0)) resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { pool, log, settle };
};

/** A view one chunk wide, centred on (x, y) in chunk units. */
const at = (x: number, y: number) => ({ minX: (x - 0.5) * SIZE, minY: (y - 0.5) * SIZE, maxX: (x + 0.5) * SIZE - 1, maxY: (y + 0.5) * SIZE - 1 });
const hotList = (streamer: ChunkStreamer) => [...streamer.hot].sort((a, b) => a - b);

describe("ChunkStreamer", () => {
  test("heats the view plus a ring, generating what's missing", () => {
    const { pool, log } = fakePool();
    const streamer = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, ring: 1, budget: 16 });
    streamer.update(at(0.5, 0.5));
    expect(streamer.hot.size).toBe(9);
    expect(log.filter((l) => l.startsWith("generate")).length).toBe(9);
    expect(log.filter((l) => l.startsWith("hot")).length).toBe(9);
  });

  test("spends at most the budget per update, nearest first", () => {
    const { pool, log } = fakePool();
    const streamer = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, ring: 1, budget: 3 });
    streamer.update(at(0.5, 0.5));
    expect(log.filter((l) => l.startsWith("generate"))[0]).toBe("generate 0,0");
    expect(streamer.hot.size).toBe(3);
    streamer.update(at(0.5, 0.5));
    streamer.update(at(0.5, 0.5));
    expect(streamer.hot.size).toBe(9);
  });

  test("hysteresis: a camera wobbling on a border doesn't thrash", () => {
    const { pool, log } = fakePool();
    const streamer = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, ring: 0, hysteresis: 0.5 });
    streamer.update(at(0.5, 0.5));
    const before = hotList(streamer);
    const path = [0.6, 0.4, 0.7, 0.3, 0.55];
    for (const x of path) streamer.update(at(x, 0.5));
    // Only the first entry into the chunks to the right heats them; nothing cools.
    expect(log.filter((l) => l.startsWith("warm"))).toEqual([]);
    expect(hotList(streamer)).toEqual(expect.arrayContaining(before));
    // Moving well away does cool them.
    streamer.update(at(3.5, 0.5));
    expect(streamer.hot.has(chunkKey(0, 0))).toBe(false);
    expect(log).toContain("warm 0,0");
  });

  test("chunks far from view go cold as bytes and come back from them", async () => {
    const { pool, log, settle } = fakePool();
    const streamer = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, ring: 0, warmRing: 1, hysteresis: 0 });
    streamer.update(at(0.5, 0.5));
    streamer.update(at(10.5, 0.5));
    expect(log).toContain("unload 0,0");
    await settle();
    expect(streamer.cold.get(chunkKey(0, 0))).toEqual(new Uint8Array([0, 0]));
    log.length = 0;
    streamer.update(at(0.5, 0.5));
    expect(log).toContain("load 0,0 [0,0]");
    expect(log).not.toContain("generate 0,0");
    expect(streamer.cold.has(chunkKey(0, 0))).toBe(false);
  });

  test("a cold store the owner gives outlives the streamer: the next streamer loads from it", async () => {
    const { pool, log, settle } = fakePool();
    const cold = new Map<number, Uint8Array>();
    const first = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, ring: 0, warmRing: 1, hysteresis: 0, cold });
    expect(first.cold).toBe(cold);
    first.update(at(0.5, 0.5));
    first.update(at(10.5, 0.5));
    await settle();
    expect(cold.get(chunkKey(0, 0))).toEqual(new Uint8Array([0, 0]));
    log.length = 0;
    const next = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, ring: 0, warmRing: 1, hysteresis: 0, cold });
    next.update(at(0.5, 0.5));
    expect(log).toContain("load 0,0 [0,0]");
    expect(log).not.toContain("generate 0,0");
    expect(cold.has(chunkKey(0, 0))).toBe(false);
  });

  test("kept-warm chunks never unload, and missing chunks are skipped", async () => {
    const { pool, log, settle } = fakePool();
    const streamer = new ChunkStreamer(pool, {
      chunkSize: SIZE,
      seed: 1,
      ring: 1,
      warmRing: 0,
      hysteresis: 0,
      keepWarm: () => true,
      exists: (cx, cy) => cx >= 0 && cy >= 0,
    });
    streamer.update(at(0.5, 0.5));
    expect(streamer.hot.size).toBe(4);
    streamer.update(at(20.5, 20.5));
    await settle();
    expect(log.filter((l) => l.startsWith("unload"))).toEqual([]);
  });

  test("owned chunks are the run's: never generated, loaded or unloaded here, heated once the run loads them", async () => {
    const { pool, log, settle } = fakePool();
    const owned = (cx: number) => cx < 10;
    const streamer = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, ring: 0, warmRing: 0, hysteresis: 0, owned });
    streamer.update(at(0.5, 0.5));
    expect(log).toEqual([]);
    expect(streamer.hot.size).toBe(0);
    // The run loads it: the view heats it.
    pool.generate(0, 0, 1);
    log.length = 0;
    streamer.update(at(0.5, 0.5));
    expect(log).toEqual(["hot 0,0"]);
    // The run unloads it while in view: no longer hot, and heated again once back.
    pool.chunks.delete(chunkKey(0, 0));
    streamer.update(at(0.5, 0.5));
    expect(streamer.hot.size).toBe(0);
    pool.generate(0, 0, 1);
    log.length = 0;
    streamer.update(at(0.5, 0.5));
    expect(log).toEqual(["hot 0,0"]);
    // The view leaves: cooled, never unloaded; an unowned chunk it passes is the streamer's as before.
    streamer.update(at(20.5, 0.5));
    streamer.update(at(40.5, 0.5));
    await settle();
    expect(log).toEqual(["hot 0,0", "warm 0,0", "generate 20,0", "hot 20,0", "warm 20,0", "generate 40,0", "hot 40,0", "unload 20,0"]);
  });

  test("a chunk wanted while it unloads waits for the bytes instead of regenerating", async () => {
    const { pool, log, settle } = fakePool();
    const streamer = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, ring: 0, warmRing: 0, hysteresis: 0 });
    streamer.update(at(0.5, 0.5));
    streamer.update(at(5.5, 0.5));
    streamer.update(at(0.5, 0.5));
    expect(log.filter((l) => l === "generate 0,0").length).toBe(1);
    await settle();
    streamer.update(at(0.5, 0.5));
    expect(log).toContain("load 0,0 [0,0]");
    expect(streamer.hot.has(chunkKey(0, 0))).toBe(true);
  });

  test("snapshot rate changes apply to hot chunks", () => {
    const { pool } = fakePool();
    const streamer = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, ring: 0 });
    streamer.update(at(0.5, 0.5));
    streamer.setSnapshotEvery(3);
    expect(pool.chunks.get(chunkKey(0, 0))!.snapshotEvery).toBe(3);
  });
});
