import { it, expect } from "vitest";
import { setImmediate } from "node:timers/promises";
import { AssetCache, type AssetRecord, type AssetStore } from "../engine/data/AssetCache";

type TestAsset = AssetRecord & { body: Uint8Array<ArrayBuffer> };
async function asset(bytes: number, seed: number): Promise<TestAsset> {
  const body = Uint8Array.from({ length: bytes }, (_, i) => (seed + i) % 256);
  const sha256 = Buffer.from(await crypto.subtle.digest("SHA-256", body)).toString("hex");
  return { path: `data/${seed}`, bytes, sha256, body };
}
function memory() {
  const entries = new Map<string, ArrayBuffer>();
  const store: AssetStore = {
    read: async key => entries.get(key),
    write: async (key, bytes) => { entries.set(key, bytes); },
  };
  return { entries, store };
}
async function until(ready: () => boolean) {
  const end = Date.now() + 1000;
  while (!ready()) {
    if (Date.now() >= end) throw new Error("Expected persistent-store boundary was not reached");
    await setImmediate();
  }
}
const largest = await asset(8, 100);
const small = await Promise.all(Array.from({ length: 7 }, (_, i) => asset(1, i + 1)));
const byPath = new Map([largest, ...small].map(row => [row.path, row]));
function rowFor(url: RequestInfo | URL): TestAsset {
  const row = byPath.get(new URL(String(url)).pathname.slice(1));
  if (!row) throw new Error("Unexpected asset URL");
  return row;
}

it("limits overlapping downloads and reports input progress only after durable commits", async () => {
  const { entries } = memory();
  const commits: { key: string; resolve: () => void }[] = [];
  const progress: number[][] = [], fetched = new Map<string, number>();
  let hold = false, count = 0, bytes = 0, peakCount = 0, peakBytes = 0;
  const cache = new AssetCache({
    read: async key => entries.get(key),
    write: async (key, body) => {
      if (hold) await new Promise<void>(resolve => commits.push({ key, resolve }));
      entries.set(key, body); count--; bytes -= body.byteLength;
    },
  }, async url => {
    const row = rowFor(url);
    fetched.set(row.sha256, (fetched.get(row.sha256) ?? 0) + 1);
    count++; bytes += row.bytes;
    peakCount = Math.max(peakCount, count); peakBytes = Math.max(peakBytes, bytes);
    return new Response(row.body);
  });
  await cache.load("https://local/", largest);
  hold = true; peakBytes = peakCount = 0;
  const loading = cache.preload("https://local/", [largest, ...small], (done, total) => progress.push([done, total]));
  expect(progress).toEqual([[0, 15], [8, 15]]);
  await until(() => commits.length === 4);
  const ordinary = cache.load("https://local/", small[0]);
  for (const commit of commits.filter(row => row.key !== small[0].sha256)) commit.resolve();
  await setImmediate();
  expect(progress).toEqual([[0, 15], [8, 15]]);
  hold = false;
  commits.find(row => row.key === small[0].sha256)!.resolve();
  await loading;
  expect(await ordinary).toBe(entries.get(small[0].sha256));
  expect(progress).toEqual([[0, 15], ...Array.from({ length: 8 }, (_, i) => [8 + i, 15])]);
  expect(peakCount).toBe(4); expect(peakBytes).toBeLessThanOrEqual(largest.bytes);
  expect(fetched.get(small[0].sha256)).toBe(1);
  for (const row of small) expect(new Uint8Array(entries.get(row.sha256)!)).toEqual(row.body);
  await cache.preload("https://local/", [largest, ...small]);
  expect([...fetched.values()]).toEqual(Array(8).fill(1));
}, 5000);

it("serializes large bodies at the byte limit and preserves zero, duplicate and empty progress", async () => {
  const zero = await asset(0, 20), first = await asset(8, 30), second = await asset(8, 40);
  const rows = [first, second, zero, zero], { store, entries } = memory();
  let bytes = 0, peak = 0, zeroFetches = 0;
  const cache = new AssetCache(store, async url => {
    const row = rows.find(row => String(url).endsWith("/" + row.path))!;
    if (row === zero) zeroFetches++;
    bytes += row.bytes; peak = Math.max(peak, bytes);
    await setImmediate(); bytes -= row.bytes;
    return new Response(row.body);
  });
  const progress: number[][] = [];
  await cache.preload("https://local/", rows, (done, total) => progress.push([done, total]));
  expect(progress).toEqual([[0, 16], [8, 16], [16, 16], [16, 16], [16, 16]]);
  expect(peak).toBeLessThanOrEqual(8); expect(zeroFetches).toBe(1); expect(entries.size).toBe(3);
  const empty: number[][] = [];
  await cache.preload("https://local/", [], (done, total) => empty.push([done, total]));
  expect(empty).toEqual([[0, 0]]);
}, 5000);

it("settles already dispatched suffix commits and preserves the first input error object", async () => {
  for (const failureAt of [0, 2]) {
    const { store, entries } = memory(), failure = { failureAt }, seen: string[] = [];
    entries.set(largest.sha256, largest.body.buffer);
    const cache = new AssetCache({ ...store, write: async (key, bytes) => {
      await setImmediate();
      if (key === small[failureAt].sha256) throw failure;
      entries.set(key, bytes);
    } }, async url => {
      const row = rowFor(url); seen.push(row.sha256); return new Response(row.body);
    });
    await cache.load("https://local/", largest);
    const progress: number[][] = [];
    await expect(cache.preload("https://local/", [largest, ...small], (done, total) => progress.push([done, total]))).rejects.toBe(failure);
    expect(seen).toHaveLength(4); expect(entries.size).toBe(4);
    expect(progress).toEqual([[0, 15], [8, 15], ...Array.from({ length: failureAt }, (_, i) => [9 + i, 15])]);
  }
}, 5000);

it("settles the window after a progress callback throws, without dispatching another window", async () => {
  const { store, entries } = memory(), failure = { progress: true }, seen: string[] = [];
  const cache = new AssetCache(store, async url => {
    const row = rowFor(url); seen.push(row.sha256); return new Response(row.body);
  });
  await cache.load("https://local/", largest); seen.length = 0;
  await expect(cache.preload("https://local/", [largest, ...small], done => {
    if (done > largest.bytes) throw failure;
  })).rejects.toBe(failure);
  expect(entries.size).toBe(5); expect(seen).toHaveLength(4);
}, 5000);

it("handles verified records inside a window and preserves malformed-record prefix progress", async () => {
  const { store } = memory(), cache = new AssetCache(store, async url => new Response(rowFor(url).body));
  await cache.load("https://local/", largest);
  const progress: number[][] = [];
  await cache.preload("https://local/", [small[0], largest, small[1]], (done, total) => progress.push([done, total]));
  expect(progress).toEqual([[0, 10], [1, 10], [9, 10], [10, 10]]);
  const invalidProgress: number[][] = [];
  await expect(cache.preload("https://local/", [small[2], { ...small[3], bytes: -1 }], (done, total) => invalidProgress.push([done, total]))).rejects.toThrow("Invalid asset record");
  expect(invalidProgress).toEqual([[0, 0], [1, 0]]);
  await expect(cache.preload("https://local/", [{ ...small[4], bytes: NaN }])).rejects.toThrow("Invalid asset record");
}, 5000);

it("chooses the earliest input error even when a later failure completes first", async () => {
  const { store, entries } = memory(), first = { first: true }, later = { later: true };
  const cache = new AssetCache({ ...store, write: async (key, body) => {
    if (key === small[0].sha256) { await new Promise(resolve => setTimeout(resolve, 10)); throw first; }
    if (key === small[2].sha256) throw later;
    entries.set(key, body);
  } }, async url => new Response(rowFor(url).body));
  await cache.load("https://local/", largest);
  await expect(cache.preload("https://local/", [largest, ...small])).rejects.toBe(first);
  expect(entries.size).toBe(3);
}, 5000);
