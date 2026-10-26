/** Several spaces on the same hosts, the protocol handshake, the campaign clock and trips. */
import { addComponent, addEntity, createWorld, type World } from "minecs";
import { describe, expect, test } from "vitest";
import { chunkKey, keyAddress, spaceChunkKey } from "yage/streaming/coord";
import { ChunkHost, type ChunkModule } from "yage/streaming/host";
import { ChunkPool, type HeldTrip } from "yage/streaming/pool";
import {
  decodeMessage,
  encodeGenerate,
  encodeHello,
  encodeTier,
  encodeTrack,
  Op,
  PROTOCOL_VERSION,
  Tier,
  type Message,
} from "yage/streaming/protocol";
import { ChunkStreamer } from "yage/streaming/streamer";
import { memoryTransportPair } from "yage/streaming/transport";
import { SIZE, TestGid, TestPos, TestVel } from "./fixture";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Person = { x: number; y: number; gid: number; timer?: number; leaves?: boolean };

/**
 * People keyed by "space:cx,cy". Each space has its own "climate" (its static data and stats
 * start with the space id). `vx` stands in for a disease timer that must survive every move; it
 * counts up by the ticks stepped. People with `leaves` depart on a trip (txn = gid) on their
 * first step.
 */
const spacesModule = (layout: Record<string, Person[]>, capacity = 8): ChunkModule => {
  const leaving = new Set<number>();
  return {
    chunkSize: SIZE,
    tickRate: 10,
    warmEvery: 1,
    margin: 5,
    components: [TestPos, TestVel, TestGid],
    position: { component: TestPos, x: "x", y: "y" },
    gid: { component: TestGid, field: "id" },
    generate(_seed, cx, cy, space) {
      const world = createWorld(capacity) as World;
      for (const person of layout[`${space}:${cx},${cy}`] ?? []) {
        const eid = addEntity(world);
        addComponent(world, TestPos, eid);
        addComponent(world, TestVel, eid);
        addComponent(world, TestGid, eid);
        world(TestPos).store.x[eid] = person.x;
        world(TestPos).store.y[eid] = person.y;
        world(TestVel).store.vx[eid] = person.timer ?? 0;
        world(TestGid).store.id[eid] = person.gid;
        if (person.leaves) leaving.add(person.gid);
      }
      return world;
    },
    step(world, ctx) {
      for (const eid of world.entitySparseSet.dense) world(TestVel).store.vx[eid] += ctx.ticks;
    },
    departing(world) {
      const groups: { txn: number; eids: number[] }[] = [];
      for (const eid of world.entitySparseSet.dense) {
        const gid = world(TestGid).store.id[eid];
        if (leaving.delete(gid)) groups.push({ txn: gid, eids: [eid] });
      }
      return groups;
    },
    render(world, snapshot) {
      for (const eid of world.entitySparseSet.dense) {
        snapshot.gid[eid] = world(TestGid).store.id[eid];
        snapshot.tint[eid] = 1;
      }
    },
    stats: (world) => new Uint8Array([world.entitySparseSet.dense.length]),
    staticData: (_world, cx, cy, space) => new Uint8Array([space, cx + 10, cy + 10]),
    describe: () => 3,
  };
};

const connect = (host: ChunkHost, hello = true) => {
  const [client, hostSide] = memoryTransportPair();
  host.attach(hostSide);
  const messages: Message[] = [];
  client.onMessage((bytes) => messages.push(decodeMessage(bytes)));
  if (hello) client.send(encodeHello());
  return {
    send: (bytes: Uint8Array) => client.send(bytes),
    messages,
    all<T extends Message["op"]>(op: T) {
      return messages.filter((m) => m.op === op) as Extract<Message, { op: T }>[];
    },
  };
};

const find = (hosts: ChunkHost[], gid: number) => {
  for (const [index, host] of hosts.entries()) {
    for (const chunk of host.chunks.values()) {
      for (const eid of chunk.world.entitySparseSet.dense) {
        if (chunk.world(TestGid).store.id[eid] === gid) {
          const w = chunk.world;
          return { host: index, space: chunk.space, cx: chunk.cx, cy: chunk.cy, x: w(TestPos).store.x[eid], timer: w(TestVel).store.vx[eid] };
        }
      }
    }
  }
  return null;
};

const count = (hosts: ChunkHost[], gid: number) => {
  let n = 0;
  for (const host of hosts)
    for (const chunk of host.chunks.values())
      for (const eid of chunk.world.entitySparseSet.dense) if (chunk.world(TestGid).store.id[eid] === gid) n++;
  return n;
};

describe("space-qualified chunk addresses", () => {
  test("space keys round-trip, and space 0 keys equal plain chunk keys", () => {
    expect(spaceChunkKey(0, -3, 7)).toBe(chunkKey(-3, 7));
    for (const address of [
      { space: 0, cx: 0, cy: 0 },
      { space: 1, cx: -32768, cy: 32767 },
      { space: 65535, cx: 12, cy: -40 },
    ]) {
      expect(keyAddress(spaceChunkKey(address.space, address.cx, address.cy))).toEqual(address);
    }
    expect(spaceChunkKey(1, 0, 0)).not.toBe(spaceChunkKey(2, 0, 0));
    expect(() => spaceChunkKey(65536, 0, 0)).toThrow(RangeError);
  });

  test("chunk (0,0) of two spaces are separate chunks with their own static data, stats and tracking", () => {
    const host = new ChunkHost(spacesModule({ "1:0,0": [{ x: 10, y: 10, gid: 11 }], "2:0,0": [{ x: 20, y: 20, gid: 21 }, { x: 30, y: 30, gid: 22 }] }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 5, 1));
    client.send(encodeGenerate(0, 0, 5, 2));
    expect(host.chunks.size).toBe(2);
    expect(client.all(Op.Ready).map((m) => [m.space, m.cx, m.cy, m.population])).toEqual([
      [1, 0, 0, 1],
      [2, 0, 0, 2],
    ]);

    client.send(encodeTier(0, 0, Tier.Hot, 1, 2));
    client.send(encodeTrack([11, 22]));
    host.tick();
    expect(client.all(Op.Static).map((m) => [m.space, ...m.bytes])).toEqual([[2, 2, 10, 10]]);
    const snapshots = client.all(Op.Snapshot).map((m) => m.snapshot);
    expect(snapshots.map((s) => [s.space, s.cx, s.cy])).toEqual([[2, 0, 0]]);
    const stats = client.all(Op.Stats).at(-1)!.entries;
    expect(stats.map((e) => [e.space, e.cx, e.cy, e.bytes[0]]).sort()).toEqual([
      [1, 0, 0, 1],
      [2, 0, 0, 2],
    ]);
    const located = client.all(Op.Locate).at(-1)!.entries;
    expect(located.map((e) => [e.gid, e.space, e.cx, e.cy]).sort()).toEqual([
      [11, 1, 0, 0],
      [22, 2, 0, 0],
    ]);
  });

  test("walking hand-offs stay inside their space", () => {
    const host = new ChunkHost(spacesModule({ "1:0,0": [{ x: SIZE + 20, y: 10, gid: 5 }] }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1, 1));
    client.send(encodeGenerate(1, 0, 1, 2)); // same coordinates as the target, other space
    client.send(encodeGenerate(1, 0, 1, 1));
    host.tick();
    expect(find([host], 5)).toMatchObject({ space: 1, cx: 1, cy: 0 });
  });
});

describe("protocol versions", () => {
  test("a host answers Hello and ignores a client on another version, saying why", () => {
    const host = new ChunkHost(spacesModule({ "0:0,0": [{ x: 1, y: 1, gid: 1 }] }));
    const old = connect(host, false);
    old.send(encodeHello(1));
    old.send(encodeGenerate(0, 0, 1));
    expect(host.chunks.size).toBe(0);
    expect(old.all(Op.Hello)[0].version).toBe(PROTOCOL_VERSION);
    expect(old.all(Op.Log).some((m) => m.level === 2 && /mismatch/.test(m.text))).toBe(true);
  });

  test("a client of the same build may skip Hello", () => {
    const host = new ChunkHost(spacesModule({}));
    const inProcess = connect(host, false);
    inProcess.send(encodeGenerate(0, 0, 1));
    expect(host.chunks.size).toBe(1);
  });

  test("the pool reports a host on another version", () => {
    const pool = new ChunkPool();
    const logs: string[] = [];
    pool.on({ log: (_level, text) => logs.push(text) });
    const [client, hostSide] = memoryTransportPair();
    pool.addHost(client, "local");
    hostSide.onMessage(() => {});
    hostSide.send(encodeHello(99));
    expect(pool.hosts[0].version).toBe(99);
    expect(logs[0]).toMatch(/v99/);
  });
});

/** A pool over in-memory hosts; chunk x picks the host. */
const setup = (layout: Record<string, Person[]>, count = 2, capacity = 8) => {
  const module = spacesModule(layout, capacity);
  const hosts = Array.from({ length: count }, () => new ChunkHost(module));
  const pool = new ChunkPool((cx) => ((cx % count) + count) % count);
  for (const host of hosts) {
    const [client, hostSide] = memoryTransportPair();
    host.attach(hostSide);
    pool.addHost(client, "local");
  }
  return { pool, hosts };
};

describe("campaign clock", () => {
  test("hosts agree on the committed tick and a fast host waits for a slow one", async () => {
    const { pool, hosts } = setup({});
    const epochs: number[] = [];
    pool.on({ epoch: (tick) => epochs.push(tick) });
    pool.setMaxLead(2);
    const [fast, slow] = hosts;
    expect(fast.tick()).toBe(true);
    expect(fast.tick()).toBe(true);
    // Two ticks past the committed tick 0: held.
    expect(fast.tick()).toBe(false);
    expect(fast.tickCount).toBe(2);
    expect(pool.committed).toBe(0);

    expect(slow.tick()).toBe(true);
    expect(pool.committed).toBe(1);
    expect(fast.committed).toBe(1);
    expect(fast.tick()).toBe(true);
    expect(fast.tick()).toBe(false);
    slow.tick();
    slow.tick();
    expect(pool.committed).toBe(3);
    expect(epochs).toEqual([1, 2, 3]);
    // Neither host is ever more than maxLead past the other.
    expect(Math.abs(fast.tickCount - slow.tickCount)).toBeLessThanOrEqual(2);
  });

  test("without a lead bound hosts keep their own time", () => {
    const { hosts } = setup({});
    for (let i = 0; i < 5; i++) expect(hosts[0].tick()).toBe(true);
  });
});

describe("trips between spaces", () => {
  const layout = {
    "1:0,0": [{ x: 50, y: 50, gid: 42, timer: 100, leaves: true }, { x: 10, y: 10, gid: 43 }],
    "2:1,0": [{ x: 10, y: 10, gid: 50 }],
  };

  const depart = async () => {
    const { pool, hosts } = setup(layout);
    const departed: HeldTrip[] = [];
    pool.on({ departed: (trip) => departed.push(trip) });
    pool.generate(0, 0, 1, undefined, 1); // host 0
    pool.generate(1, 0, 1, undefined, 2); // host 1
    await flush();
    pool.track([42]);
    hosts.forEach((h) => h.tick());
    return { pool, hosts, departed };
  };

  test("a tracked traveller departs once, is held in transit, arrives in another space and resumes", async () => {
    const { pool, hosts, departed } = await depart();
    expect(departed.map((t) => [t.txn, t.space, t.cx, t.cy, t.count])).toEqual([[42, 1, 0, 0, 1]]);
    // In transit: owned by the pool only.
    expect(count(hosts, 42)).toBe(0);
    expect(pool.trips.size).toBe(1);

    const arrivals: [number, number][] = [];
    const located: [number, number, number][] = [];
    pool.on({ arrived: (txn, n) => arrivals.push([txn, n]), locate: (e) => located.push([e.gid, e.space ?? 0, e.cx]) });
    expect(pool.arrive(42, 2, 1, 0, 60, 70)).toBe(true);
    expect(arrivals).toEqual([[42, 1]]);
    expect(pool.trips.size).toBe(0);
    // Timer stepped once at the origin (100 + 1), unchanged in transit, then resumes.
    expect(find(hosts, 42)).toMatchObject({ host: 1, space: 2, cx: 1, cy: 0, x: 60, timer: 101 });
    hosts.forEach((h) => h.tick());
    expect(find(hosts, 42)!.timer).toBe(102);
    expect(located.at(-1)).toEqual([42, 2, 1]);
    expect(count(hosts, 42)).toBe(1);
  });

  test("a repeated Arrive adds nobody", async () => {
    const { pool, hosts } = await depart();
    const trip = pool.saveTrips()[0];
    pool.arrive(42, 2, 1, 0, 60, 70);
    // A retry after the acknowledgement was lost: the trip comes back from a save and is resent.
    pool.restoreTrips([trip]);
    pool.arrive(42, 2, 1, 0, 60, 70);
    expect(count(hosts, 42)).toBe(1);
    expect(pool.trips.size).toBe(0);
  });

  test("a full destination keeps the whole group queued for a retry", async () => {
    const { pool, hosts } = setup(
      { "1:0,0": [{ x: 50, y: 50, gid: 42, leaves: true }], "2:1,0": [{ x: 1, y: 1, gid: 60 }] },
      2,
      1
    );
    pool.generate(0, 0, 1, undefined, 1);
    pool.generate(1, 0, 1, undefined, 2);
    await flush();
    hosts.forEach((h) => h.tick());
    const arrivals: number[] = [];
    pool.on({ arrived: (_txn, n) => arrivals.push(n) });
    pool.arrive(42, 2, 1, 0, 5, 5);
    expect(arrivals).toEqual([0]);
    expect(pool.trips.get(42)).toMatchObject({ count: 1, sent: false });
    expect(count(hosts, 42)).toBe(0);
  });

  test("trips in transit survive a save and reload of the pool", async () => {
    const { pool } = await depart();
    const saved = pool.saveTrips();
    const { pool: fresh, hosts: freshHosts } = setup({ "2:1,0": [] });
    fresh.generate(1, 0, 1, undefined, 2);
    await flush();
    fresh.restoreTrips(saved);
    fresh.arrive(42, 2, 1, 0, 1, 2);
    expect(find(freshHosts, 42)).toMatchObject({ space: 2, timer: 101 });
  });
});

describe("streamer per space", () => {
  test("a streamer only loads and unloads chunks of its own space", async () => {
    const { pool } = setup({});
    const a = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, space: 1, ring: 0, warmRing: 0, hysteresis: 0 });
    const b = new ChunkStreamer(pool, { chunkSize: SIZE, seed: 1, space: 2, ring: 0, warmRing: 0, hysteresis: 0 });
    a.update({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    b.update({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    await flush();
    const spaces = () => [...pool.chunks.values()].map((c) => `${c.space}:${c.cx},${c.cy}`).sort();
    expect(spaces()).toEqual(["1:0,0", "2:0,0"]);
    // Space 1's view moves away: only its own chunk unloads.
    a.update({ minX: 510, minY: 10, maxX: 520, maxY: 20 });
    await flush();
    a.update({ minX: 510, minY: 10, maxX: 520, maxY: 20 });
    await flush();
    expect(spaces()).toEqual(["1:5,0", "2:0,0"]);
  });
});
