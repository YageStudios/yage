import { describe, expect, test } from "vitest";
import { addComponent, addEntity, createWorld, deserializeWorld, type World } from "minecs";
import { ChunkHost, type ChunkModule } from "yage/streaming/host";
import { spaceChunkKey } from "yage/streaming/coord";
import { ChunkPool } from "yage/streaming/pool";
import { Tier, type ExitedMessage, type SavedChunk } from "yage/streaming/protocol";
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
const walkModule = (exits = false): ChunkModule => {
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
    generate(_seed, cx, cy, _space, init) {
      const world = createWorld(14) as World;
      // Generated with init bytes (mid-run, after an unload): as many walkers as they say.
      for (let i = 0; i < (init ? init[0] : 9); i++) {
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
    exits,
    command(world, bytes) {
      for (const eid of world.entitySparseSet.dense) world(TestVel).store.vx[eid] = bytes[0] - 128;
    },
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

/** The chunk generated mid-run, on hosts that defer generating: it is born on its stamped tick, wherever it lands. */
const LATE = [GRID - 1, GRID - 1] as const;
/** The chunk `cycle` unloads and generates again. */
const CYCLED = [1, 2] as const;

/**
 * Runs the walk on `hosts` hosts (chunk placement and the order of everything shuffled by `seed`).
 * With `view`, a view wanders past the grid's east edge (chunks there come and go as it says) and
 * watches grid chunks closely now and then, which changes nothing simulated.
 * With `save`, a checkpoint saves every grid chunk mid-run (pool.save), stamped like the rest.
 * With `from`, the hosts start from a checkpoint instead: resumed at its tick, its chunks loaded.
 * With `cycle`, the run unloads a grid chunk mid-run (stamped) and later generates it again with
 * init bytes counting the walkers it had. With `exits` too, walkers who walk into it while it is gone
 * leave for the page (Exited), which holds them and, once it is back, puts them in (Enter) on its
 * passes in (tick, from-chunk) order, then sends it a Command.
 */
const run = async (hosts: number, seed: number, view = false, save = false, from?: { tick: number; chunks: SavedChunk[] }, cycle = false, exits = false) => {
  const rng = seeded(seed);
  const net = network(rng);
  const placementOf = new Map<string, number>();
  const pool = new ChunkPool((cx, cy) => placementOf.get(`${cx},${cy}`) ?? Math.floor(rng() * hosts));
  pool.lead = 1;
  const list = Array.from({ length: hosts }, () => new ChunkHost(walkModule(exits), { deferGenerates: true }));
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
  let unloaded: Uint8Array | null = null;
  const held: ExitedMessage[] = [];
  let exited = 0;
  pool.on({
    exited: (exit) => {
      held.push(exit);
      exited += exit.count;
    },
    stats: (entries, _host, tick) => entries.forEach((e) => inGrid(e.cx, e.cy) && stats.set(`${tick}:${e.cx},${e.cy}`, e.bytes[0])),
    unloaded: (cx, cy, bytes) => {
      if (cx === CYCLED[0] && cy === CYCLED[1]) unloaded = bytes;
    },
  });
  const keys = Array.from({ length: GRID * GRID }, (_, i) => [i % GRID, Math.floor(i / GRID)] as const).sort(() => rng() - 0.5);
  keys.forEach(([cx, cy]) => placementOf.set(`${cx},${cy}`, Math.floor(rng() * hosts)));
  if (from) {
    pool.resume(from.tick);
    for (const chunk of from.chunks) pool.load(chunk.cx, chunk.cy, chunk.bytes);
  } else for (const [cx, cy] of keys) if (cx !== LATE[0] || cy !== LATE[1]) pool.generate(cx, cy, 1);
  await Promise.resolve();
  while (net.deliverOne());

  // The page's passes: every PASS committed ticks it acts, stamped with the limit, then lets the hosts run on.
  let pass = from ? from.tick / PASS : 0;
  let saving: Promise<{ tick: number; chunks: SavedChunk[] }> | undefined;
  const page = () => {
    while (pool.committed >= pass * PASS && pass * PASS <= TICKS) {
      if (cycle && pass === 5) void pool.unload(CYCLED[0], CYCLED[1]);
      // Its bytes are in by the time the hosts have run past the tick it went on.
      if (cycle && pass === 8) {
        const walkers = (deserializeWorld(unloaded!.slice().buffer) as World).entitySparseSet.dense.length;
        pool.generate(CYCLED[0], CYCLED[1], 1, undefined, 0, new Uint8Array([walkers]));
      }
      if (exits && pass >= 9) {
        const due = held.filter((e) => e.tick < pass * PASS).sort((a, b) => a.tick - b.tick || a.fx - b.fx || a.fy - b.fy);
        for (const e of due) {
          held.splice(held.indexOf(e), 1);
          expect(pool.enter(0, e.cx, e.cy, e.fx, e.fy, e.count, e.rows)).toBe(true);
        }
        if (pass === 12) expect(pool.command(CYCLED[0], CYCLED[1], new Uint8Array([200]))).toBe(true);
      }
      if (pass === 4) pool.generate(LATE[0], LATE[1], 1);
      if (pass % 3 === 1) pool.configure(new Uint8Array([1 + (pass % 2)]));
      if (pass === 2) pool.input(1 + 5 * 100 + 3, new Uint8Array([150]));
      // What steps hot is the run's (setSimTier, stamped), the same for every run.
      if (pass === 3) pool.setSimTier(1, 1, Tier.Hot);
      if (pass === 9) pool.setSimTier(1, 1, Tier.Warm);
      if (pass === 6) pool.setSimTier(2, 2, Tier.Hot);
      if (pass === 5 && save) saving = pool.save(keys.map(([cx, cy]) => ({ cx, cy })));
      pool.setLimit(Math.min(TICKS, pass * PASS + 2 * PASS));
      pass++;
    }
  };
  page();
  const outside = new Set<string>();
  const wander = () => {
    if (!view || rng() > 0.05) return;
    // What a view watches closely (whenever its frames fall) changes nothing simulated.
    if (rng() < 0.5) return pool.setTier(Math.floor(rng() * GRID), Math.floor(rng() * GRID), rng() < 0.5 ? Tier.Hot : Tier.Warm);
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
  const walkersOf = (chunks: { cx: number; cy: number; world: World }[]) => {
    const walkers: string[] = [];
    for (const chunk of chunks) {
      if (!inGrid(chunk.cx, chunk.cy)) continue;
      const { x, y } = chunk.world(TestPos).store;
      const id = chunk.world(TestGid).store.id;
      for (const eid of chunk.world.entitySparseSet.dense) walkers.push(`${id[eid]}@${chunk.cx},${chunk.cy}:${x[eid].toFixed(4)},${y[eid].toFixed(4)}`);
    }
    return walkers.sort();
  };
  for (const host of list) expect(host.tickCount).toBe(TICKS);
  const saved = saving && (await saving);
  const checkpoint = saved && {
    tick: saved.tick,
    chunks: saved.chunks.map((c) => `${c.cx},${c.cy}`),
    walkers: walkersOf(saved.chunks.map((c) => ({ ...c, world: deserializeWorld(c.bytes.slice().buffer) as World }))),
  };
  return {
    walkers: walkersOf(list.flatMap((host) => [...host.chunks.values()])),
    stats,
    dropped: list.reduce((n, h) => n + h.dropped, 0),
    inFlight: list.reduce((n, h) => n + h.inFlight(), 0),
    exited,
    held: held.reduce((n, e) => n + e.count, 0),
    unloaded: unloaded && (deserializeWorld((unloaded as Uint8Array).slice().buffer) as World).entitySparseSet.dense.length,
    checkpoint,
    saved,
  };
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

  test("a chunk unloaded mid-run goes on its stamped tick, and one generated with init bytes is born from them, the same on any hosts in any order", async () => {
    const alone = await run(1, 1);
    const first = await run(1, 13, false, false, undefined, true);
    expect(first.unloaded).toBeGreaterThan(0);
    // Gone from its stamped tick (the limit pass 5 found, pass 6's) until it was born again on pass 9's: no counts for it between.
    expect([...first.stats.keys()].filter((k) => k.endsWith(`:${CYCLED[0]},${CYCLED[1]}`)).every((k) => {
      const tick = Number(k.split(":")[0]);
      return tick < 6 * PASS || tick >= 9 * PASS;
    })).toBe(true);
    expect([...first.stats.keys()].some((k) => k.endsWith(`:${CYCLED[0]},${CYCLED[1]}`) && Number(k.split(":")[0]) >= 9 * PASS)).toBe(true);
    expect([...first.stats.keys()].some((k) => k.endsWith(`:${CYCLED[0]},${CYCLED[1]}`) && Number(k.split(":")[0]) < 6 * PASS)).toBe(true);
    expect(first.walkers).not.toEqual(alone.walkers);
    for (const [hosts, seed, view] of [[3, 14, false], [4, 15, true], [2, 16, true]] as const) {
      const other = await run(hosts, seed, view, false, undefined, true);
      expect(other.unloaded, `${hosts} ${seed}`).toBe(first.unloaded);
      expect(other.walkers).toEqual(first.walkers);
      expect(other.stats).toEqual(first.stats);
      expect(other.dropped).toBe(first.dropped);
    }
  });

  test("walkers into a gone chunk of the map leave for the page, which puts them back in once it is there again, the same on any hosts in any order", async () => {
    const bounced = await run(1, 13, false, false, undefined, true);
    const first = await run(1, 13, false, false, undefined, true, true);
    expect(first.exited).toBeGreaterThan(0);
    // Nobody lost: walking into the gone chunk takes them off the map until the page puts them back.
    expect(first.walkers.length + first.dropped + first.inFlight + first.held).toBe(GRID * GRID * 9);
    expect(first.walkers).not.toEqual(bounced.walkers);
    for (const [hosts, seed, view] of [[3, 17, false], [4, 18, true], [2, 19, true]] as const) {
      const other = await run(hosts, seed, view, false, undefined, true, true);
      expect(other.exited, `${hosts} ${seed}`).toBe(first.exited);
      expect(other.held).toBe(first.held);
      expect(other.walkers).toEqual(first.walkers);
      expect(other.stats).toEqual(first.stats);
      expect(other.dropped).toBe(first.dropped);
    }
  });

  test("a save mid-run takes every chunk at the start of its stamped tick, on any host in any order, and changes nothing", async () => {
    const alone = await run(1, 1);
    const first = await run(1, 7, false, true);
    // The limit when it was asked: every chunk as the ticks before it left them, none unloaded.
    expect(first.checkpoint!.tick).toBe(6 * PASS);
    expect(first.checkpoint!.chunks.length).toBe(GRID * GRID);
    expect(first.checkpoint!.walkers.length).toBeGreaterThan(GRID * GRID * 6);
    for (const [hosts, seed, view] of [[3, 8, false], [4, 9, true]] as const) {
      const other = await run(hosts, seed, view, true);
      expect(other.checkpoint).toEqual(first.checkpoint);
      expect(other.walkers).toEqual(alone.walkers);
      expect(other.stats).toEqual(alone.stats);
    }
    expect(first.walkers).toEqual(alone.walkers);
    expect(first.checkpoint!.walkers).not.toEqual(alone.walkers);
  });

  test("hosts resumed at a checkpoint's tick run on from it the same on any hosts in any order; a host that has run refuses", async () => {
    const { saved } = await run(1, 7, false, true);
    const first = await run(1, 10, false, false, saved!);
    // Rows in flight when it was taken aren't in it; the rest walk on.
    expect(first.walkers.length).toBeGreaterThan(GRID * GRID * 6);
    // Nothing before the checkpoint's tick ran again.
    const ticks = [...first.stats.keys()].map((key) => Number(key.split(":")[0]));
    expect(Math.min(...ticks)).toBe(saved!.tick);
    for (const [hosts, seed, view] of [[3, 11, false], [4, 12, true]] as const) {
      const other = await run(hosts, seed, view, false, saved!);
      expect(other.walkers).toEqual(first.walkers);
      expect(other.stats).toEqual(first.stats);
      expect(other.dropped).toBe(first.dropped);
    }
    const pool = new ChunkPool();
    pool.lead = 1;
    const host = new ChunkHost(walkModule());
    const [client, side] = network(() => 0).pair();
    host.attach(side);
    pool.addHost(client, "local");
    pool.setLimit(1);
    expect(() => pool.resume(5)).toThrow(/already run/);
  });
});
