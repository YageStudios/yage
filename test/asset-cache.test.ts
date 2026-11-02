import { describe, it, expect } from "vitest";
import { AssetCache, type AssetStore } from "../engine/data/AssetCache";

const bytes = new TextEncoder().encode("world").buffer;
const sha256 = Array.from(
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
  (value) => value.toString(16).padStart(2, "0")
).join("");
const asset = { path: "data/world", bytes: bytes.byteLength, sha256 };
const memory = () => {
  const entries = new Map<string, ArrayBuffer>();
  const store: AssetStore = {
    read: async (key) => entries.get(key),
    write: async (key, value) => {
      entries.set(key, value);
    },
  };
  return { store, entries };
};
describe("content-addressed assets", () => {
  it("coalesces concurrent requests and reloads offline", async () => {
    const { store } = memory();
    let calls = 0;
    const cache = new AssetCache(store, async () => {
      calls++;
      return new Response(bytes);
    });
    await Promise.all([
      cache.load("https://local/", asset),
      cache.load("https://local/", asset),
    ]);
    const offline = new AssetCache(store, async () => {
      throw new Error("offline");
    });
    expect(await offline.load("https://local/", asset)).toEqual(bytes);
    expect(calls).toBe(1);
  });
  it("repairs corrupted cached bytes", async () => {
    const { store, entries } = memory();
    entries.set(sha256, new ArrayBuffer(5));
    const cache = new AssetCache(store, async () => new Response(bytes));
    expect(await cache.load("https://local/", asset)).toEqual(bytes);
    expect(entries.get(sha256)).toEqual(bytes);
  });
  it("rejects HTTP, digest and size errors without caching and permits retry", async () => {
    for (const response of [
      new Response(null, { status: 404 }),
      new Response("other"),
      new Response("x"),
    ]) {
      const { store, entries } = memory();
      let fail = true;
      const cache = new AssetCache(store, async () =>
        fail ? response : new Response(bytes)
      );
      await expect(cache.load("https://local/", asset)).rejects.toThrow();
      expect(entries.size).toBe(0);
      fail = false;
      expect(await cache.load("https://local/", asset)).toEqual(bytes);
    }
  });
  it("reports durable-write failures", async () => {
    const cache = new AssetCache(
      {
        read: async () => undefined,
        write: async () => {
          throw new Error("quota");
        },
      },
      async () => new Response(bytes)
    );
    await expect(cache.load("https://local/", asset)).rejects.toThrow("quota");
  });
  it("validates records before requesting data", async () => {
    const { store } = memory();
    const cache = new AssetCache(store, async () => {
      throw new Error("unexpected fetch");
    });
    for (const patch of [
      { path: "../secret" },
      { path: "/secret" },
      { path: "https://remote" },
      { bytes: -1 },
      { sha256: "bad" },
    ]) {
      await expect(
        cache.load("https://local/", { ...asset, ...patch })
      ).rejects.toThrow("Invalid asset record");
    }
  });
  it("preloads and reports cumulative byte progress", async () => {
    const { store } = memory();
    const progress: number[][] = [];
    await new AssetCache(store, async () => new Response(bytes)).preload(
      "https://local/",
      [asset],
      (done, total) => progress.push([done, total])
    );
    expect(progress).toEqual([
      [0, 5],
      [5, 5],
    ]);
  });
});
