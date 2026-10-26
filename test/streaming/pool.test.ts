import { describe, expect, test } from "vitest";
import { ChunkHost } from "yage/streaming/host";
import { ChunkPool } from "yage/streaming/pool";
import { Tier, type Snapshot } from "yage/streaming/protocol";
import { memoryTransportPair } from "yage/streaming/transport";
import { SIZE, testModule, TestGid, TestPos, type Walker } from "./fixture";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A pool over `count` in-memory hosts with no peer links, so every hand-off goes via the pool. */
const setup = (layout: Record<string, Walker[]>, count = 2, capacity = 16) => {
  const module = testModule(layout, capacity);
  const hosts = Array.from({ length: count }, () => new ChunkHost(module));
  // Chunk x picks the host, so the border between x=0 and x=1 crosses hosts.
  const pool = new ChunkPool((cx) => ((cx % count) + count) % count);
  for (const host of hosts) {
    const [client, hostSide] = memoryTransportPair();
    host.attach(hostSide);
    pool.addHost(client, "local");
  }
  const tick = () => hosts.forEach((host) => host.tick());
  return { pool, hosts, tick };
};

const where = (hosts: ChunkHost[], gid: number) => {
  for (const [index, host] of hosts.entries()) {
    for (const chunk of host.chunks.values()) {
      for (const eid of chunk.world.entitySparseSet.dense) {
        if (chunk.world(TestGid).store.id[eid] === gid) {
          return { host: index, cx: chunk.cx, cy: chunk.cy, x: chunk.world(TestPos).store.x[eid] };
        }
      }
    }
  }
  return null;
};

describe("ChunkPool", () => {
  test("places chunks, reports Ready and relays snapshots", async () => {
    const { pool, hosts, tick } = setup({ "0,0": [{ x: 10, y: 10, gid: 1 }], "1,0": [{ x: 10, y: 10, gid: 2 }] });
    const ready: string[] = [];
    const snapshots: Snapshot[] = [];
    pool.on({ ready: (c) => ready.push(`${c.cx},${c.cy}`), snapshot: (s) => snapshots.push(s) });
    pool.generate(0, 0, 1);
    pool.generate(1, 0, 1);
    await flush();
    expect(ready.sort()).toEqual(["0,0", "1,0"]);
    expect(hosts[0].chunks.size).toBe(1);
    expect(hosts[1].chunks.size).toBe(1);

    pool.setTier(1, 0, Tier.Hot, 1);
    tick();
    expect(snapshots.map((s) => [s.cx, s.gid[0]])).toEqual([[1, 2]]);
    expect(pool.hosts[1].tick).toBe(snapshots[0].tick);
  });

  test("forwards hand-offs between hosts with no direct link", async () => {
    const { pool, hosts, tick } = setup({ "0,0": [{ x: SIZE - 1, y: 50, vx: 1, gid: 7 }] });
    pool.generate(0, 0, 1);
    pool.generate(1, 0, 1);
    pool.setTier(0, 0, Tier.Hot);
    pool.setTier(1, 0, Tier.Hot);
    await flush();
    for (let i = 0; i < 8; i++) tick();
    expect(where(hosts, 7)).toMatchObject({ host: 1, cx: 1, cy: 0 });
    expect(where(hosts, 7)!.x).toBeGreaterThan(0);
    expect(where(hosts, 7)!.x).toBeLessThan(SIZE);
  });

  test("sends a hand-off back when the destination chunk isn't loaded", async () => {
    const { pool, hosts, tick } = setup({ "0,0": [{ x: SIZE - 1, y: 50, vx: 1, gid: 7 }] });
    pool.generate(0, 0, 1);
    pool.setTier(0, 0, Tier.Hot);
    await flush();
    for (let i = 0; i < 8; i++) tick();
    const found = where(hosts, 7)!;
    expect(found).toMatchObject({ host: 0, cx: 0 });
    // Bounced inside, then free to drift back into the overlap margin.
    expect(found.x).toBeLessThan(SIZE + 5);
  });

  test("moves a chunk between hosts, holding hand-offs until it lands", async () => {
    const { pool, hosts, tick } = setup(
      {
        "0,0": [{ x: SIZE - 1, y: 50, vx: 1, gid: 7 }],
        "1,0": [{ x: 20, y: 20, gid: 8 }],
      },
      3
    );
    pool.generate(0, 0, 1);
    pool.generate(1, 0, 1);
    pool.setTier(0, 0, Tier.Hot);
    pool.setTier(1, 0, Tier.Hot);
    await flush();

    const moving = pool.move(1, 0, 2);
    // Host 0 now routes x=1 to the pool, which holds the hand-off until the chunk lands.
    for (let i = 0; i < 8; i++) tick();
    await moving;
    await flush();
    expect(hosts[1].chunks.size).toBe(0);
    expect(where(hosts, 8)).toMatchObject({ host: 2, cx: 1 });
    expect(where(hosts, 7)).toMatchObject({ host: 2, cx: 1 });
    // The tier came along: the moved chunk keeps stepping every tick.
    const before = where(hosts, 7)!.x;
    tick();
    expect(where(hosts, 7)!.x).toBe(before + 1);
  });

  test("unloads to bytes and loads them elsewhere", async () => {
    const { pool, hosts } = setup({ "0,0": [{ x: 10, y: 10, gid: 3 }] });
    pool.generate(0, 0, 1);
    await flush();
    const bytes = await pool.unload(0, 0);
    expect(pool.chunks.size).toBe(0);
    expect(where(hosts, 3)).toBeNull();
    pool.load(0, 0, bytes, 1);
    await flush();
    expect(where(hosts, 3)).toMatchObject({ host: 1, cx: 0, x: 10 });
    expect(pool.hosts.map((h) => h.chunks)).toEqual([0, 1]);
  });

  test("late hosts get the current config and tracking", async () => {
    const module = testModule({ "0,0": [{ x: 10, y: 10, vx: 1, gid: 5 }] });
    const pool = new ChunkPool(() => 0);
    pool.configure(new Uint8Array([3]));
    pool.track([5]);
    const host = new ChunkHost(module);
    const [client, hostSide] = memoryTransportPair();
    host.attach(hostSide);
    const located: [number, number][] = [];
    pool.on({ locate: (entry, _host, tick) => located.push([entry.gid, tick]) });
    pool.addHost(client, "remote");
    pool.generate(0, 0, 1);
    pool.setTier(0, 0, Tier.Hot);
    await flush();
    host.tick();
    expect(where([host], 5)!.x).toBe(13);
    // Found after the host's first step, and said so.
    expect(located).toContainEqual([5, host.tickCount - 1]);
  });
});
