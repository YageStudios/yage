import { describe, expect, test } from "vitest";
import { addComponent, addEntity, createWorld, type World } from "minecs";
import { ChunkHost, type ChunkModule } from "yage/streaming/host";
import { spaceChunkKey } from "yage/streaming/coord";
import { ChunkPool } from "yage/streaming/pool";
import { Tier } from "yage/streaming/protocol";
import type { ChunkTransport } from "yage/streaming/transport";
import { SIZE, TestGid, TestPos, TestVel } from "./fixture";

const GRID = 4;
const PASS = 5;
const TICKS = 120;

const inGrid = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < GRID && cy < GRID;

const mix = (...values: number[]) => {
  let h = 2166136261;
  for (const v of values) h = Math.imul(h ^ (v >>> 0), 16777619) ^ (h >>> 13);
  return h >>> 0;
};

/**
 * Walkers on a GRID × GRID map whose steps are keyed on (gid, tick), so they cross borders all the
 * time; chunks hold few, so hand-offs get turned away; every chunk posts its head count and every
 * host's walkers speed up with the running total, so a post landing a tick early or late shows.
 */
const walkModule = (): ChunkModule => {
  let scale = 1;
  let shared = 0;
  return {
    chunkSize: SIZE,
    tickRate: 10,
    warmEvery: 4,
    margin: 5,
    lockstep: 1,
    components: [TestPos, TestVel, TestGid],
    position: { component: TestPos, x: "x", y: "y" },
    gid: { component: TestGid, field: "id" },
    generate(_seed, cx, cy) {
      const world = createWorld(14) as World;
      for (let i = 0; i < 9; i++) {
        const eid = addEntity(world);
        addComponent(world, TestPos, eid);
        addComponent(world, TestVel, eid);
        addComponent(world, TestGid, eid);
        world(TestPos).store.x[eid] = 10 + i * 9;
        world(TestPos).store.y[eid] = 50;
        world(TestGid).store.id[eid] = 1 + (inGrid(cx, cy) ? cy * GRID + cx : 1000 + cy * GRID + cx) * 100 + i;
      }
      return world;
    },
    step(world, ctx) {
      const pos = world(TestPos).store;
      const vel = world(TestVel).store;
      const gid = world(TestGid).store;
      const pace = 1 + (shared % 7) / 7;
      for (const eid of world.entitySparseSet.dense) {
        const h = mix(gid.id[eid], ctx.tick);
        pos.x[eid] += (((h & 255) / 255 - 0.5) * 24 + vel.vx[eid]) * ctx.ticks * scale * pace;
        pos.y[eid] += (((h >>> 8) & 255) / 255 - 0.5) * 24 * ctx.ticks * scale * pace;
      }
    },
    render() {},
    stats(world) {
      return new Uint8Array([world.entitySparseSet.dense.length]);
    },
    post(world) {
      return new Uint8Array([world.entitySparseSet.dense.length]);
    },
    receive(bytes) {
      shared += bytes[0];
    },
    configure(bytes) {
      scale = bytes[0];
    },
    input(world, eid, bytes) {
      world(TestVel).store.vx[eid] = bytes[0] - 128;
    },
    simulates: (_space, cx, cy) => inGrid(cx, cy),
  };
};

/** Channels that deliver each one's messages in order, but interleave channels as `rng` says. */
const network = (rng: () => number) => {
  const channels: { queue: Uint8Array[]; deliver: (bytes: Uint8Array) => void }[] = [];
  const end = () => {
    const channel = { queue: [] as Uint8Array[], deliver: (_bytes: Uint8Array) => {} };
    channels.push(channel);
    return channel;
  };
  const pair = (): [ChunkTransport, ChunkTransport] => {
    const ab = end();
    const ba = end();
    return [
      { send: (bytes) => ab.queue.push(bytes.slice()), onMessage: (handler) => (ba.deliver = handler) },
      { send: (bytes) => ba.queue.push(bytes.slice()), onMessage: (handler) => (ab.deliver = handler) },
    ];
  };
  /** Delivers one message from a random non-empty channel; false when all are empty. */
  const deliverOne = () => {
    const busy = channels.filter((c) => c.queue.length);
    if (!busy.length) return false;
    const channel = busy[Math.floor(rng() * busy.length)];
    channel.deliver(channel.queue.shift()!);
    return true;
  };
  return { pair, deliverOne };
};

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * Runs the walk on `hosts` hosts (chunk placement and the order of everything shuffled by `seed`).
 * With `view`, a view wanders past the grid's east edge: chunks there come and go as it says.
 */
const run = async (hosts: number, seed: number, view = false) => {
  const rng = seeded(seed);
  const net = network(rng);
  const placementOf = new Map<string, number>();
  const pool = new ChunkPool((cx, cy) => placementOf.get(`${cx},${cy}`) ?? Math.floor(rng() * hosts));
  pool.lead = 1;
  const list = Array.from({ length: hosts }, () => new ChunkHost(walkModule()));
  for (let a = 0; a < hosts; a++) {
    for (let b = a + 1; b < hosts; b++) {
      const [ab, ba] = net.pair();
      list[a].addPeer(b, ab);
      list[b].addPeer(a, ba);
    }
  }
  for (const host of list) {
    const [client, side] = net.pair();
    host.attach(side);
    pool.addHost(client, "local");
  }
  const stats = new Map<string, number>();
  pool.on({ stats: (entries, _host, tick) => entries.forEach((e) => inGrid(e.cx, e.cy) && stats.set(`${tick}:${e.cx},${e.cy}`, e.bytes[0])) });
  const keys = Array.from({ length: GRID * GRID }, (_, i) => [i % GRID, Math.floor(i / GRID)] as const).sort(() => rng() - 0.5);
  keys.forEach(([cx, cy]) => placementOf.set(`${cx},${cy}`, Math.floor(rng() * hosts)));
  for (const [cx, cy] of keys) pool.generate(cx, cy, 1);
  await Promise.resolve();
  while (net.deliverOne());

  // The page's passes: every PASS committed ticks it acts, stamped with the limit, then lets the hosts run on.
  let pass = 0;
  const page = () => {
    while (pool.committed >= pass * PASS && pass * PASS <= TICKS) {
      if (pass % 3 === 1) pool.configure(new Uint8Array([1 + (pass % 2)]));
      if (pass === 2) pool.input(1 + 5 * 100 + 3, new Uint8Array([150]));
      // Watched hot steps hot (setTier stamps it): the same for every run, as the view is.
      if (pass === 3) pool.setTier(1, 1, Tier.Hot);
      if (pass === 9) pool.setTier(1, 1, Tier.Warm);
      if (pass === 6) pool.setSimTier(2, 2, Tier.Hot);
      pool.setLimit(Math.min(TICKS, pass * PASS + 2 * PASS));
      pass++;
    }
  };
  page();
  const outside = new Set<string>();
  const wander = () => {
    if (!view || rng() > 0.05) return;
    const cy = Math.floor(rng() * GRID);
    const key = `${GRID},${cy}`;
    if (!outside.has(key)) {
      outside.add(key);
      pool.generate(GRID, cy, 1);
    } else if (pool.chunks.get(spaceChunkKey(0, GRID, cy))?.ready) {
      outside.delete(key);
      void pool.unload(GRID, cy);
    }
  };
  for (let guard = 0; guard < 1e6; guard++) {
    wander();
    const ready = list.filter((h) => h.canTick());
    if (ready.length && rng() < 0.5) ready[Math.floor(rng() * ready.length)].tick();
    else if (!net.deliverOne() && ready.length) ready[0].tick();
    page();
    if (list.every((h) => h.tickCount >= TICKS) && !net.deliverOne()) break;
  }
  const walkers: string[] = [];
  for (const host of list) {
    expect(host.tickCount).toBe(TICKS);
    for (const chunk of host.chunks.values()) {
      if (!inGrid(chunk.cx, chunk.cy)) continue;
      const { x, y } = chunk.world(TestPos).store;
      const id = chunk.world(TestGid).store.id;
      for (const eid of chunk.world.entitySparseSet.dense) walkers.push(`${id[eid]}@${chunk.cx},${chunk.cy}:${x[eid].toFixed(4)},${y[eid].toFixed(4)}`);
    }
  }
  return { walkers: walkers.sort(), stats, dropped: list.reduce((n, h) => n + h.dropped, 0), inFlight: list.reduce((n, h) => n + h.inFlight(), 0) };
};

describe("lockstep", () => {
  test("one host, or several fed in any order, run the same world: hand-offs, posts and stamped messages land on their ticks", async () => {
    const alone = await run(1, 1);
    expect(alone.walkers.length + alone.dropped + alone.inFlight).toBe(GRID * GRID * 9);
    // Hand-offs happened, and some were turned away by full chunks.
    const moved = alone.walkers.filter((w) => {
      const [gid, at] = w.split(/[@:]/);
      const home = Math.floor((Number(gid) - 1) / 100);
      return `${home % GRID},${Math.floor(home / GRID)}` !== at;
    });
    expect(moved.length).toBeGreaterThan(20);
    for (const [hosts, seed, view] of [[3, 2, false], [4, 3, true], [4, 4, false], [2, 5, true], [1, 6, true]] as const) {
      const other = await run(hosts, seed, view);
      expect(other.walkers).toEqual(alone.walkers);
      expect(other.stats).toEqual(alone.stats);
      expect(other.dropped).toBe(alone.dropped);
      expect(other.inFlight).toBe(alone.inFlight);
    }
  });
});
