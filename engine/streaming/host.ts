/**
 * ChunkHost runs a set of chunk worlds for a game-supplied ChunkModule and speaks the chunk
 * protocol to whoever is attached. It imports only minecs, so it runs in a Web Worker or a Node
 * process without loading the rest of YAGE (and without registering YAGE's components in the
 * chunk worlds).
 *
 * The host owns the clock. Every tick it steps hot chunks, steps a staggered share of warm
 * chunks, hands entities that crossed a border to their new chunk, then sends snapshots, tracked
 * entity locations and per-chunk stats.
 */
import { deleteWorld, deserializeWorld, SerialMode, serializeWorld, type Schema, type World } from "minecs";
import { chunkHash, chunkKey, chunkX, chunkY } from "./coord";
import {
  createSnapshot,
  decodeMessage,
  EMPTY_SLOT,
  encodeLocate,
  encodeLog,
  encodeReady,
  encodeStatic,
  encodeStats,
  encodeTransfer,
  encodeUnloaded,
  NO_HOST,
  Op,
  Tier,
  type LocateEntry,
  type Message,
  type Snapshot,
  type StatsEntry,
} from "./protocol";
import { putRows, takeRows } from "./rows";
import { portTransport, type ChunkTransport } from "./transport";

export type StepContext = {
  /** Host tick number. */
  tick: number;
  /** Ticks this step covers: 1 for hot chunks, `warmEvery` for warm ones. */
  ticks: number;
  /** Seconds this step covers. */
  dt: number;
  cx: number;
  cy: number;
};

export interface ChunkModule {
  /** World units per chunk side. */
  chunkSize: number;
  /** Simulation ticks per second. */
  tickRate: number;
  /** Warm chunks step once every this many ticks (staggered), with `ticks` set accordingly. */
  warmEvery: number;
  /** How far past its border an entity may stray before it's handed to the neighbour. */
  margin: number;
  /** Components carried when an entity moves between chunks. Flat numeric columns only. */
  components: (typeof Schema)[];
  /** Chunk-local position. Entities without this component never move between chunks. */
  position: { component: typeof Schema; x: string; y: string };
  /** A globally unique id that survives hand-offs, used for tracking and input. */
  gid: { component: typeof Schema; field: string };

  /** Creates the chunk's world. Must be a pure function of the arguments (and configuration). */
  generate(seed: number, cx: number, cy: number): World;
  step(world: World, ctx: StepContext): void;
  /**
   * Fills a snapshot. Slots arrive with `tint` set to EMPTY_SLOT; write every live entity that
   * should be drawn: `x`/`y` in chunk-local units × POSITION_SCALE, `sprite`, `tint` and `gid`.
   */
  render(world: World, snapshot: Snapshot): void;
  /** Small per-chunk stats (population, counts…) sent after each step. */
  stats?(world: World): Uint8Array;
  /** Game configuration broadcast to every chunk (e.g. evolution traits). */
  configure?(bytes: Uint8Array): void;
  /** Applies the latest input for a controlled entity; called before each step of its chunk. */
  input?(world: World, eid: number, bytes: Uint8Array, ctx: StepContext): void;
  /** A one-byte state for a tracked entity's Locate entry. */
  describe?(world: World, eid: number): number;
  /** Static per-chunk data (e.g. terrain) sent once when a client first watches a chunk. */
  staticData?(world: World, cx: number, cy: number): Uint8Array;
  /** Called when an entity was kept inside its chunk because no neighbour could take it. */
  bounced?(world: World, eid: number): void;
  /** Entities counted as the chunk's population in Ready messages. Defaults to all entities. */
  population?(world: World): number;
}

type Chunk = {
  key: number;
  cx: number;
  cy: number;
  world: World;
  phase: number;
};

type Subscription = { tier: Tier; snapshotEvery: number };

type Connection = {
  transport: ChunkTransport;
  subscriptions: Map<number, Subscription>;
  tracked: Set<number>;
  sentStatic: Set<number>;
};

export type ChunkHostOptions = {
  /** Start the tick loop immediately. Tests leave it off and call `tick()` themselves. */
  autoTick?: boolean;
};

export class ChunkHost {
  readonly chunks = new Map<number, Chunk>();
  private readonly connections: Connection[] = [];
  private readonly peers = new Map<number, ChunkTransport>();
  private readonly route = new Map<number, number>();
  private readonly inputs = new Map<number, Uint8Array>();
  private readonly located = new Map<number, { key: number; eid: number }>();
  private trackDirty = true;
  private selfIndex = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  tickCount = 0;
  lastBusyMs = 0;
  /** Rows dropped because neither the destination nor the origin had room. */
  dropped = 0;

  constructor(readonly module: ChunkModule, options: ChunkHostOptions = {}) {
    if (options.autoTick) this.start();
  }

  /** Adds a client. The first client is also the upstream for transfers to unknown hosts. */
  attach(transport: ChunkTransport) {
    const connection: Connection = {
      transport,
      subscriptions: new Map(),
      tracked: new Set(),
      sentStatic: new Set(),
    };
    this.connections.push(connection);
    transport.onMessage((bytes) => this.receive(connection, bytes));
    return () => {
      const index = this.connections.indexOf(connection);
      if (index >= 0) this.connections.splice(index, 1);
    };
  }

  /** Adds a direct link to another host, used for hand-offs to chunks it owns. */
  addPeer(index: number, transport: ChunkTransport) {
    this.peers.set(index, transport);
    transport.onMessage((bytes) => this.receive(null, bytes));
  }

  start() {
    if (this.timer) return;
    const interval = 1000 / this.module.tickRate;
    let due = performance.now();
    const loop = () => {
      this.tick();
      due += interval;
      const now = performance.now();
      // Fall behind gracefully: never queue a burst of catch-up ticks.
      if (due < now - interval) due = now;
      this.timer = setTimeout(loop, Math.max(0, due - now));
    };
    this.timer = setTimeout(loop, 0);
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // -------------------------------------------------------------------------------------------
  // Messages

  receive(connection: Connection | null, bytes: Uint8Array) {
    let message: Message;
    try {
      message = decodeMessage(bytes);
    } catch (error) {
      this.log(2, `Bad message: ${(error as Error).message}`);
      return;
    }
    switch (message.op) {
      case Op.Generate:
        this.generate(message.cx, message.cy, message.seed);
        break;
      case Op.Load:
        this.load(message.cx, message.cy, message.bytes);
        break;
      case Op.Unload: {
        const bytes = this.unload(message.cx, message.cy);
        if (bytes && connection) connection.transport.send(encodeUnloaded(message.cx, message.cy, bytes), true);
        break;
      }
      case Op.Tier:
        if (connection) this.subscribe(connection, message.cx, message.cy, message.tier, message.snapshotEvery);
        break;
      case Op.Config:
        this.module.configure?.(message.bytes.slice());
        break;
      case Op.Input:
        // Empty input releases the entity.
        if (message.bytes.byteLength === 0) {
          this.inputs.delete(message.gid);
          this.trackDirty = true;
        } else this.inputs.set(message.gid, message.bytes.slice());
        break;
      case Op.Track:
        if (connection) {
          connection.tracked = new Set(message.gids);
          this.trackDirty = true;
        }
        break;
      case Op.Route:
        this.selfIndex = message.self;
        for (const entry of message.entries) {
          const key = chunkKey(entry.cx, entry.cy);
          if (entry.host === NO_HOST) this.route.delete(key);
          else this.route.set(key, entry.host);
        }
        break;
      case Op.Transfer:
        this.acceptTransfer(message.cx, message.cy, message.fx, message.fy, message.returned, message.count, message.rows);
        break;
      default:
        this.log(1, `Host ignored op ${message.op}`);
    }
  }

  private broadcast(bytes: Uint8Array) {
    for (let i = 0; i < this.connections.length; i++) {
      this.connections[i].transport.send(bytes, i === this.connections.length - 1);
    }
  }

  private log(level: number, text: string) {
    this.broadcast(encodeLog(level, text));
  }

  // -------------------------------------------------------------------------------------------
  // Chunk lifecycle

  generate(cx: number, cy: number, seed: number) {
    const key = chunkKey(cx, cy);
    if (!this.chunks.has(key)) {
      this.addChunk(cx, cy, this.module.generate(seed, cx, cy));
    }
    this.ready(key);
  }

  load(cx: number, cy: number, bytes: Uint8Array) {
    const key = chunkKey(cx, cy);
    const existing = this.chunks.get(key);
    if (existing) deleteWorld(existing.world);
    const world = deserializeWorld(bytes.slice().buffer) as World;
    this.addChunk(cx, cy, world);
    this.ready(key);
  }

  unload(cx: number, cy: number): Uint8Array | null {
    const key = chunkKey(cx, cy);
    const chunk = this.chunks.get(key);
    if (!chunk) return null;
    const payload = serializeWorld(SerialMode.BINARY, chunk.world) as ArrayBuffer;
    deleteWorld(chunk.world);
    this.chunks.delete(key);
    this.route.delete(key);
    for (const connection of this.connections) connection.sentStatic.delete(key);
    return new Uint8Array(payload);
  }

  private addChunk(cx: number, cy: number, world: World) {
    const key = chunkKey(cx, cy);
    this.chunks.set(key, { key, cx, cy, world, phase: chunkHash(cx, cy) % this.module.warmEvery });
    this.route.set(key, this.selfIndex);
    this.trackDirty = true;
  }

  private ready(key: number) {
    const chunk = this.chunks.get(key)!;
    const population = this.module.population?.(chunk.world) ?? chunk.world.entitySparseSet.dense.length;
    this.broadcast(encodeReady(chunk.cx, chunk.cy, population));
  }

  private subscribe(connection: Connection, cx: number, cy: number, tier: Tier, snapshotEvery: number) {
    const key = chunkKey(cx, cy);
    connection.subscriptions.set(key, { tier, snapshotEvery });
    const chunk = this.chunks.get(key);
    if (tier === Tier.Hot && chunk && this.module.staticData && !connection.sentStatic.has(key)) {
      connection.sentStatic.add(key);
      connection.transport.send(encodeStatic(cx, cy, this.module.staticData(chunk.world, cx, cy)), true);
    }
  }

  private isHot(key: number) {
    for (const connection of this.connections) {
      if (connection.subscriptions.get(key)?.tier === Tier.Hot) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Tick

  tick() {
    const start = performance.now();
    const tick = this.tickCount++;
    const { warmEvery, tickRate } = this.module;
    const stats: StatsEntry[] = [];
    const stepped: Chunk[] = [];

    for (const chunk of this.chunks.values()) {
      const hot = this.isHot(chunk.key);
      if (!hot && (tick + chunk.phase) % warmEvery !== 0) continue;
      const ticks = hot ? 1 : warmEvery;
      const ctx: StepContext = { tick, ticks, dt: ticks / tickRate, cx: chunk.cx, cy: chunk.cy };
      this.applyInputs(chunk, ctx);
      this.module.step(chunk.world, ctx);
      stepped.push(chunk);
    }
    // Hand-offs run after every chunk has stepped, so an entity moves at most once per tick.
    for (const chunk of stepped) {
      this.handOff(chunk);
    }
    for (const chunk of stepped) {
      const bytes = this.module.stats?.(chunk.world);
      if (bytes) stats.push({ cx: chunk.cx, cy: chunk.cy, bytes });
    }

    this.sendSnapshots(tick);
    this.sendLocations(tick);
    this.lastBusyMs = performance.now() - start;
    this.broadcast(encodeStats(tick, this.lastBusyMs, stats));
  }

  private applyInputs(chunk: Chunk, ctx: StepContext) {
    if (!this.module.input || this.inputs.size === 0) return;
    for (const [gid, bytes] of this.inputs) {
      const location = this.locate(gid);
      if (location && location.key === chunk.key) this.module.input(chunk.world, location.eid, bytes, ctx);
    }
  }

  private gidColumn(world: World): ArrayLike<number> {
    return (world as any)(this.module.gid.component).store[this.module.gid.field];
  }

  private positionColumns(world: World): [Float32Array | Float64Array, Float32Array | Float64Array] {
    const store = (world as any)(this.module.position.component).store;
    return [store[this.module.position.x], store[this.module.position.y]];
  }

  /** Finds a tracked entity on this host, rescanning only when something may have moved it here. */
  private locate(gid: number): { key: number; eid: number } | null {
    const cached = this.located.get(gid);
    if (cached) {
      const chunk = this.chunks.get(cached.key);
      if (chunk && chunk.world.entitySparseSet.has(cached.eid) && this.gidColumn(chunk.world)[cached.eid] === gid) {
        return cached;
      }
      this.located.delete(gid);
    }
    if (!this.trackDirty) return null;
    for (const chunk of this.chunks.values()) {
      const column = this.gidColumn(chunk.world);
      const dense = chunk.world.entitySparseSet.dense;
      for (let i = 0; i < dense.length; i++) {
        if (column[dense[i]] === gid) {
          const found = { key: chunk.key, eid: dense[i] };
          this.located.set(gid, found);
          return found;
        }
      }
    }
    return null;
  }

  private trackedGids(): Set<number> {
    const all = new Set<number>(this.inputs.keys());
    for (const connection of this.connections) for (const gid of connection.tracked) all.add(gid);
    return all;
  }

  private sendLocations(tick: number) {
    const tracked = this.trackedGids();
    if (tracked.size === 0) return;
    const entries: LocateEntry[] = [];
    for (const gid of tracked) {
      const location = this.locate(gid);
      if (!location) continue;
      const chunk = this.chunks.get(location.key)!;
      const [xs, ys] = this.positionColumns(chunk.world);
      entries.push({
        gid,
        cx: chunk.cx,
        cy: chunk.cy,
        x: xs[location.eid],
        y: ys[location.eid],
        tint: this.module.describe?.(chunk.world, location.eid) ?? 0,
      });
    }
    // A full scan found nothing new; wait for the next change before scanning again.
    this.trackDirty = false;
    if (entries.length) this.broadcast(encodeLocate(tick, entries));
  }

  private sendSnapshots(tick: number) {
    const built = new Map<number, Snapshot>();
    const sends: [Connection, Snapshot][] = [];
    for (const connection of this.connections) {
      for (const [key, subscription] of connection.subscriptions) {
        if (subscription.tier !== Tier.Hot || subscription.snapshotEvery === 0) continue;
        if (tick % subscription.snapshotEvery !== 0) continue;
        const chunk = this.chunks.get(key);
        if (!chunk) continue;
        let snapshot = built.get(key);
        if (!snapshot) {
          snapshot = createSnapshot(chunk.cx, chunk.cy, tick, chunk.world.entityCursor);
          snapshot.tint.fill(EMPTY_SLOT);
          this.module.render(chunk.world, snapshot);
          built.set(key, snapshot);
        }
        sends.push([connection, snapshot]);
      }
    }
    // The last send of each snapshot moves its buffer instead of copying it.
    const remaining = new Map<Snapshot, number>();
    for (const [, snapshot] of sends) remaining.set(snapshot, (remaining.get(snapshot) ?? 0) + 1);
    for (const [connection, snapshot] of sends) {
      const left = remaining.get(snapshot)! - 1;
      remaining.set(snapshot, left);
      connection.transport.send(snapshot.bytes, left === 0);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Hand-off

  private handOff(chunk: Chunk) {
    const { chunkSize: size, margin, components } = this.module;
    const world = chunk.world;
    const [xs, ys] = this.positionColumns(world);
    const positionMask = (world as any)(this.module.position.component);
    const dense = world.entitySparseSet.dense;
    let leaving: Map<number, number[]> | null = null;
    for (let i = 0; i < dense.length; i++) {
      const eid = dense[i];
      const x = xs[eid];
      const y = ys[eid];
      if (x >= -margin && y >= -margin && x < size + margin && y < size + margin) continue;
      if (!hasPosition(world, positionMask, eid)) continue;
      const target = chunkKey(chunk.cx + Math.floor(x / size), chunk.cy + Math.floor(y / size));
      leaving ??= new Map();
      let list = leaving.get(target);
      if (!list) leaving.set(target, (list = []));
      list.push(eid);
    }
    if (!leaving) return;

    for (const [target, eids] of leaving) {
      const tx = chunkX(target);
      const ty = chunkY(target);
      const local = this.chunks.get(target);
      if (local) {
        const rows = takeRows(world, components, eids);
        this.acceptTransfer(tx, ty, chunk.cx, chunk.cy, false, eids.length, rows, chunk);
        continue;
      }
      const host = this.route.get(target);
      if (host === undefined || host === NO_HOST || host === this.selfIndex) {
        for (const eid of eids) this.bounce(world, eid);
        continue;
      }
      const rows = takeRows(world, components, eids);
      const message = encodeTransfer(tx, ty, chunk.cx, chunk.cy, false, eids.length, rows);
      (this.peers.get(host) ?? this.connections[0]?.transport)?.send(message, true);
    }
  }

  private bounce(world: World, eid: number) {
    const size = this.module.chunkSize;
    const [xs, ys] = this.positionColumns(world);
    xs[eid] = Math.min(Math.max(xs[eid], 0), size - 0.01);
    ys[eid] = Math.min(Math.max(ys[eid], 0), size - 0.01);
    this.module.bounced?.(world, eid);
  }

  private acceptTransfer(
    cx: number,
    cy: number,
    fx: number,
    fy: number,
    returned: boolean,
    count: number,
    rows: Uint8Array,
    sourceChunk?: Chunk
  ) {
    const key = chunkKey(cx, cy);
    const chunk = this.chunks.get(key);
    if (!chunk) {
      // The chunk moved or was never here. Forward it if someone else owns it, else send it back.
      const host = this.route.get(key);
      if (!returned && host !== undefined && host !== NO_HOST && host !== this.selfIndex) {
        (this.peers.get(host) ?? this.connections[0]?.transport)?.send(encodeTransfer(cx, cy, fx, fy, false, count, rows), true);
      } else if (!returned) {
        this.sendBack(fx, fy, count, rows);
      } else {
        this.dropped += count;
      }
      return;
    }
    const size = this.module.chunkSize;
    const dx = (fx - cx) * size;
    const dy = (fy - cy) * size;
    const [xs, ys] = this.positionColumns(chunk.world);
    const { added, rejected, rejectedCount } = putRows(chunk.world, this.module.components, rows, count, (_, eid) => {
      xs[eid] += dx;
      ys[eid] += dy;
    });
    if (returned) {
      for (const eid of added) this.bounce(chunk.world, eid);
    }
    this.noteArrivals(chunk, added);
    if (rejectedCount === 0) return;
    if (returned) {
      this.dropped += rejectedCount;
    } else if (sourceChunk) {
      this.acceptTransfer(sourceChunk.cx, sourceChunk.cy, fx, fy, true, rejectedCount, rejected);
    } else {
      this.sendBack(fx, fy, rejectedCount, rejected);
    }
  }

  private sendBack(fx: number, fy: number, count: number, rows: Uint8Array) {
    const key = chunkKey(fx, fy);
    if (this.chunks.has(key)) {
      this.acceptTransfer(fx, fy, fx, fy, true, count, rows);
      return;
    }
    const host = this.route.get(key);
    const link = host === undefined ? this.connections[0]?.transport : this.peers.get(host) ?? this.connections[0]?.transport;
    link?.send(encodeTransfer(fx, fy, fx, fy, true, count, rows), true);
  }

  private noteArrivals(chunk: Chunk, added: number[]) {
    const tracked = this.trackedGids();
    if (tracked.size === 0) return;
    const column = this.gidColumn(chunk.world);
    for (const eid of added) {
      const gid = column[eid];
      if (tracked.has(gid)) this.located.set(gid, { key: chunk.key, eid });
    }
  }
}

const hasPosition = (world: World, component: any, eid: number) =>
  (world.entityMasks[component.generationId][eid] & component.bitflag) === component.bitflag;

/**
 * Worker entry: runs a host for `module`, attached to the page that created the worker. Call it
 * synchronously at the top level of the worker module so no early message is missed.
 */
export const runChunkHostWorker = (module: ChunkModule) => {
  const host = new ChunkHost(module);
  const scope = globalThis as unknown as Parameters<typeof portTransport>[0];
  const upstream = portTransport(scope, (data) => {
    const control = data as { type?: string; peers?: { index: number; port: MessagePort }[] };
    if (control?.type === "yage-chunk-peers") {
      for (const peer of control.peers ?? []) host.addPeer(peer.index, portTransport(peer.port));
    }
  });
  host.attach(upstream);
  host.start();
  return host;
};
