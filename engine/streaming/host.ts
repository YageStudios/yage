/**
 * ChunkHost runs a set of chunk worlds for a game-supplied ChunkModule and speaks the chunk
 * protocol to whoever is attached. It imports only minecs, so it runs in a Web Worker or a Node
 * process without loading the rest of YAGE (and without registering YAGE's components in the
 * chunk worlds).
 *
 * The host owns the clock. Every tick it steps hot chunks, steps a staggered share of warm
 * chunks, hands entities that crossed a border to their new chunk, then sends snapshots, tracked
 * entity locations and per-chunk stats.
 *
 * Chunks live in spaces (see coord.ts): every chunk, route, subscription, stat and location is
 * qualified by its space, and the module is told which space it is generating or stepping. Space
 * 0 is the default, so single-space games never mention it. Walking hand-offs stay inside a
 * space; trips (Depart / Arrive) move travellers between chunks of any space, exactly once.
 *
 * With a committed campaign tick (Commit) the host never runs more than `maxLead` ticks ahead of
 * the slowest host, so every host's work is on one timeline.
 */
import { deleteWorld, deserializeWorld, SerialMode, serializeWorld, type Schema, type World } from "minecs";
import { chunkHash, chunkX, chunkY, keySpace, spaceChunkKey } from "./coord";
import {
  createSnapshot,
  decodeMessage,
  encodeArrived,
  encodeDepart,
  encodeHello,
  EMPTY_SLOT,
  encodeLocate,
  encodeLog,
  encodeOverlay,
  encodeReady,
  encodeStatic,
  encodeStats,
  encodeTransfer,
  encodeUnloaded,
  NO_HOST,
  Op,
  PROTOCOL_VERSION,
  Tier,
  type ArriveMessage,
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
  /**
   * True when a client watches the chunk closely (Hot tier): the place to spend detail that only
   * matters on screen. Warm chunks can run a cheaper model of the same thing. The host always
   * sets it; it is optional so hand-made contexts (tests, tools) may leave it out (= warm).
   */
  hot?: boolean;
  /** The chunk's space (0 unless the game uses several). */
  space: number;
  cx: number;
  cy: number;
};

/** Passed to `ChunkModule.restored` when a chunk's world appears on a host. */
export type RestoreContext = {
  /** The host tick the chunk joins at (the tick its first step will carry, or later). */
  tick: number;
  space: number;
  cx: number;
  cy: number;
  /** True for a freshly generated world, false for one loaded from bytes. */
  generated: boolean;
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

  /**
   * Creates the chunk's world. Must be a pure function of the arguments (and configuration).
   * `space` says which map the chunk belongs to: chunk (0, 0) of two spaces are different places.
   */
  generate(seed: number, cx: number, cy: number, space: number): World;
  step(world: World, ctx: StepContext): void;
  /**
   * Fills a snapshot. Slots arrive with `tint` set to EMPTY_SLOT; write every live entity that
   * should be drawn: `x`/`y` in chunk-local units × POSITION_SCALE, `sprite`, `tint` and `gid`.
   */
  render(world: World, snapshot: Snapshot): void;
  /**
   * Game-defined bytes sent right after the chunk's snapshot (Op.Overlay), e.g. load fields,
   * effect events or extra per-slot values (index them by entity slot, like the snapshot).
   * Called at most once per chunk per tick, only on ticks that build a snapshot of it; return
   * null to send nothing. Events drained here reach every client sent that tick's snapshot.
   */
  overlay?(world: World, snapshot: Snapshot): Uint8Array | null;
  /** Small per-chunk stats (population, counts…) sent after each step. */
  stats?(world: World): Uint8Array;
  /** Game configuration broadcast to every chunk (e.g. evolution traits). */
  configure?(bytes: Uint8Array): void;
  /** Applies the latest input for a controlled entity; called before each step of its chunk. */
  input?(world: World, eid: number, bytes: Uint8Array, ctx: StepContext): void;
  /** A one-byte state for a tracked entity's Locate entry. */
  describe?(world: World, eid: number): number;
  /** Static per-chunk data (e.g. terrain) sent once when a client first watches a chunk. */
  staticData?(world: World, cx: number, cy: number, space: number): Uint8Array;
  /** Called when an entity was kept inside its chunk because no neighbour could take it. */
  bounced?(world: World, eid: number): void;
  /**
   * Called after a chunk's world is generated or loaded, with the host's current tick. A module
   * whose state is a function of time uses it to bring the chunk up to date (e.g. put people
   * where their schedules say they are now) instead of simulating the time it was away.
   */
  restored?(world: World, ctx: RestoreContext): void;
  /**
   * Called for each entity accepted from another chunk, after its position was shifted by
   * (dx, dy) into this chunk's frame. Shift any other chunk-local fields (targets, waypoints).
   */
  arrived?(world: World, eid: number, dx: number, dy: number): void;
  /** Entities counted as the chunk's population in Ready messages. Defaults to all entities. */
  population?(world: World): number;
  /**
   * Called after each step: groups of entities leaving the chunk on a trip, each under a stable
   * transaction id. Their rows go to the client, which owns them until it sends them to an
   * arrival chunk; they are removed from this world.
   */
  departing?(world: World, ctx: StepContext): { txn: number; eids: number[] }[];
}

type Chunk = {
  key: number;
  space: number;
  cx: number;
  cy: number;
  world: World;
  phase: number;
  /** Tick of the chunk's last step, -1 before its first. */
  lastStep: number;
};

type Subscription = { tier: Tier; snapshotEvery: number };

type Connection = {
  transport: ChunkTransport;
  subscriptions: Map<number, Subscription>;
  tracked: Set<number>;
  sentStatic: Set<number>;
  /** Protocol version from the client's Hello; null until it arrives. */
  version: number | null;
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
  /** Committed campaign tick (every host has completed it) and how far past it this host may run. */
  committed = 0;
  maxLead = 0;
  /** Trip transactions already applied here, so a repeated Arrive adds nobody. */
  private readonly arrivals = new Map<number, number>();

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
      version: null,
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
      if (!this.canTick()) {
        // Held by the campaign clock: wait for the slow host instead of skipping ahead.
        due = performance.now() + interval;
        this.timer = setTimeout(loop, interval);
        return;
      }
      this.tick();
      due += interval;
      const now = performance.now();
      // Fall behind gracefully: never queue a burst of catch-up ticks. Skip the missed tick
      // numbers instead, so the clock keeps to wall time and hosts started together agree on it;
      // each chunk's next step covers the skipped ticks.
      if (due < now - interval) {
        let missed = Math.floor((now - due) / interval);
        if (this.maxLead > 0) missed = Math.max(0, Math.min(missed, this.committed + this.maxLead - this.tickCount));
        this.tickCount += missed;
        due += missed * interval;
      }
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
    if (connection) {
      if (message.op === Op.Hello) {
        connection.version = message.version;
        connection.transport.send(encodeHello());
        if (message.version !== PROTOCOL_VERSION) {
          this.log(2, `Chunk protocol mismatch: client speaks v${message.version}, host speaks v${PROTOCOL_VERSION}; ignoring the client`);
        }
        return;
      }
      // A client that never said Hello is an in-process client of this build (tests, embedded
      // hosts) and is trusted; one that announced another version is not.
      if (connection.version !== null && connection.version !== PROTOCOL_VERSION) return;
    }
    switch (message.op) {
      case Op.Generate:
        this.generate(message.cx, message.cy, message.seed, message.space);
        break;
      case Op.Load:
        this.load(message.cx, message.cy, message.bytes, message.space);
        break;
      case Op.Unload: {
        const bytes = this.unload(message.cx, message.cy, message.space);
        if (bytes && connection) connection.transport.send(encodeUnloaded(message.cx, message.cy, bytes, message.space), true);
        break;
      }
      case Op.Tier:
        if (connection) this.subscribe(connection, message.space, message.cx, message.cy, message.tier, message.snapshotEvery);
        break;
      case Op.Commit:
        this.committed = Math.max(this.committed, message.tick);
        this.maxLead = message.maxLead;
        break;
      case Op.Arrive:
        this.arrive(connection, message);
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
          const key = spaceChunkKey(entry.space ?? 0, entry.cx, entry.cy);
          if (entry.host === NO_HOST) this.route.delete(key);
          else this.route.set(key, entry.host);
        }
        break;
      case Op.Transfer:
        this.acceptTransfer(message.space, message.cx, message.cy, message.fx, message.fy, message.returned, message.count, message.rows);
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

  generate(cx: number, cy: number, seed: number, space = 0) {
    const key = spaceChunkKey(space, cx, cy);
    if (!this.chunks.has(key)) {
      const world = this.module.generate(seed, cx, cy, space);
      this.addChunk(space, cx, cy, world);
      this.module.restored?.(world, { tick: this.tickCount, space, cx, cy, generated: true });
    }
    this.ready(key);
  }

  load(cx: number, cy: number, bytes: Uint8Array, space = 0) {
    const key = spaceChunkKey(space, cx, cy);
    const existing = this.chunks.get(key);
    if (existing) deleteWorld(existing.world);
    const world = deserializeWorld(bytes.slice().buffer) as World;
    this.addChunk(space, cx, cy, world);
    this.module.restored?.(world, { tick: this.tickCount, space, cx, cy, generated: false });
    this.ready(key);
  }

  unload(cx: number, cy: number, space = 0): Uint8Array | null {
    const key = spaceChunkKey(space, cx, cy);
    const chunk = this.chunks.get(key);
    if (!chunk) return null;
    const payload = serializeWorld(SerialMode.BINARY, chunk.world) as ArrayBuffer;
    deleteWorld(chunk.world);
    this.chunks.delete(key);
    this.route.delete(key);
    for (const connection of this.connections) connection.sentStatic.delete(key);
    return new Uint8Array(payload);
  }

  private addChunk(space: number, cx: number, cy: number, world: World) {
    const key = spaceChunkKey(space, cx, cy);
    this.chunks.set(key, { key, space, cx, cy, world, phase: chunkHash(cx, cy, space) % this.module.warmEvery, lastStep: -1 });
    this.route.set(key, this.selfIndex);
    this.trackDirty = true;
  }

  private ready(key: number) {
    const chunk = this.chunks.get(key)!;
    const population = this.module.population?.(chunk.world) ?? chunk.world.entitySparseSet.dense.length;
    this.broadcast(encodeReady(chunk.cx, chunk.cy, population, chunk.space));
  }

  private subscribe(connection: Connection, space: number, cx: number, cy: number, tier: Tier, snapshotEvery: number) {
    const key = spaceChunkKey(space, cx, cy);
    connection.subscriptions.set(key, { tier, snapshotEvery });
    const chunk = this.chunks.get(key);
    if (tier === Tier.Hot && chunk && this.module.staticData && !connection.sentStatic.has(key)) {
      connection.sentStatic.add(key);
      connection.transport.send(encodeStatic(cx, cy, this.module.staticData(chunk.world, cx, cy, space), space), true);
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

  /** False while the campaign clock holds this host (it is `maxLead` ticks past the committed tick). */
  canTick() {
    return this.maxLead <= 0 || this.tickCount < this.committed + this.maxLead;
  }

  /** Runs one tick; returns false (doing nothing) while the campaign clock holds this host. */
  tick(): boolean {
    if (!this.canTick()) return false;
    const start = performance.now();
    const tick = this.tickCount++;
    const { warmEvery, tickRate } = this.module;
    const stats: StatsEntry[] = [];
    const stepped: Chunk[] = [];

    for (const chunk of this.chunks.values()) {
      const hot = this.isHot(chunk.key);
      if (!hot && (tick + chunk.phase) % warmEvery !== 0) continue;
      // Normally 1 (hot) or warmEvery (warm); more when the clock skipped ticks or a slot was missed.
      const ticks = Math.max(hot ? 1 : warmEvery, chunk.lastStep < 0 ? 0 : tick - chunk.lastStep);
      chunk.lastStep = tick;
      const ctx: StepContext = { tick, ticks, dt: ticks / tickRate, hot, space: chunk.space, cx: chunk.cx, cy: chunk.cy };
      this.applyInputs(chunk, ctx);
      this.module.step(chunk.world, ctx);
      this.depart(chunk, ctx);
      stepped.push(chunk);
    }
    // Hand-offs run after every chunk has stepped, so an entity moves at most once per tick.
    for (const chunk of stepped) {
      this.handOff(chunk);
    }
    for (const chunk of stepped) {
      const bytes = this.module.stats?.(chunk.world);
      if (bytes) stats.push({ space: chunk.space, cx: chunk.cx, cy: chunk.cy, bytes });
    }

    this.sendSnapshots(tick);
    this.sendLocations(tick);
    this.lastBusyMs = performance.now() - start;
    this.broadcast(encodeStats(tick, this.lastBusyMs, stats));
    return true;
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
        space: chunk.space,
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
    const overlays = new Map<number, Uint8Array | null>();
    const sends: [Connection, Snapshot][] = [];
    const overlaySends: [Connection, Uint8Array][] = [];
    for (const connection of this.connections) {
      for (const [key, subscription] of connection.subscriptions) {
        if (subscription.tier !== Tier.Hot || subscription.snapshotEvery === 0) continue;
        if (tick % subscription.snapshotEvery !== 0) continue;
        const chunk = this.chunks.get(key);
        if (!chunk) continue;
        let snapshot = built.get(key);
        if (!snapshot) {
          snapshot = createSnapshot(chunk.cx, chunk.cy, tick, chunk.world.entityCursor, chunk.space);
          snapshot.tint.fill(EMPTY_SLOT);
          this.module.render(chunk.world, snapshot);
          built.set(key, snapshot);
          const extra = this.module.overlay?.(chunk.world, snapshot);
          overlays.set(key, extra ? encodeOverlay(chunk.cx, chunk.cy, tick, extra, chunk.space) : null);
        }
        sends.push([connection, snapshot]);
        const overlay = overlays.get(key);
        if (overlay) overlaySends.push([connection, overlay]);
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
    for (const [connection, bytes] of overlaySends) connection.transport.send(bytes, false);
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
      const target = spaceChunkKey(chunk.space, chunk.cx + Math.floor(x / size), chunk.cy + Math.floor(y / size));
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
        this.acceptTransfer(chunk.space, tx, ty, chunk.cx, chunk.cy, false, eids.length, rows, chunk);
        continue;
      }
      const host = this.route.get(target);
      if (host === undefined || host === NO_HOST || host === this.selfIndex) {
        for (const eid of eids) this.bounce(world, eid);
        continue;
      }
      const rows = takeRows(world, components, eids);
      const message = encodeTransfer(tx, ty, chunk.cx, chunk.cy, false, eids.length, rows, chunk.space);
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
    space: number,
    cx: number,
    cy: number,
    fx: number,
    fy: number,
    returned: boolean,
    count: number,
    rows: Uint8Array,
    sourceChunk?: Chunk
  ) {
    const key = spaceChunkKey(space, cx, cy);
    const chunk = this.chunks.get(key);
    if (!chunk) {
      // The chunk moved or was never here. Forward it if someone else owns it, else send it back.
      const host = this.route.get(key);
      if (!returned && host !== undefined && host !== NO_HOST && host !== this.selfIndex) {
        (this.peers.get(host) ?? this.connections[0]?.transport)?.send(encodeTransfer(cx, cy, fx, fy, false, count, rows, space), true);
      } else if (!returned) {
        this.sendBack(space, fx, fy, count, rows);
      } else {
        this.dropped += count;
      }
      return;
    }
    const size = this.module.chunkSize;
    const dx = (fx - cx) * size;
    const dy = (fy - cy) * size;
    const [xs, ys] = this.positionColumns(chunk.world);
    const arrived = this.module.arrived;
    const { added, rejected, rejectedCount } = putRows(chunk.world, this.module.components, rows, count, (_, eid) => {
      xs[eid] += dx;
      ys[eid] += dy;
    });
    if (arrived) for (const eid of added) arrived(chunk.world, eid, dx, dy);
    if (returned) {
      for (const eid of added) this.bounce(chunk.world, eid);
    }
    this.noteArrivals(chunk, added);
    if (rejectedCount === 0) return;
    if (returned) {
      this.dropped += rejectedCount;
    } else if (sourceChunk) {
      this.acceptTransfer(space, sourceChunk.cx, sourceChunk.cy, fx, fy, true, rejectedCount, rejected);
    } else {
      this.sendBack(space, fx, fy, rejectedCount, rejected);
    }
  }

  private sendBack(space: number, fx: number, fy: number, count: number, rows: Uint8Array) {
    const key = spaceChunkKey(space, fx, fy);
    if (this.chunks.has(key)) {
      this.acceptTransfer(space, fx, fy, fx, fy, true, count, rows);
      return;
    }
    const host = this.route.get(key);
    const link = host === undefined ? this.connections[0]?.transport : this.peers.get(host) ?? this.connections[0]?.transport;
    link?.send(encodeTransfer(fx, fy, fx, fy, true, count, rows, space), true);
  }

  // -------------------------------------------------------------------------------------------
  // Trips

  /** Sends the module's departing travellers to the client, which owns them until they arrive. */
  private depart(chunk: Chunk, ctx: StepContext) {
    const groups = this.module.departing?.(chunk.world, ctx);
    if (!groups?.length) return;
    const upstream = this.connections[0]?.transport;
    for (const group of groups) {
      if (!group.eids.length) continue;
      if (!upstream) {
        this.log(2, `Trip ${group.txn} has no client to depart to; travellers stay`);
        continue;
      }
      const rows = takeRows(chunk.world, this.module.components, group.eids);
      upstream.send(encodeDepart(group.txn, chunk.space, chunk.cx, chunk.cy, group.eids.length, rows), true);
    }
    this.trackDirty = true;
  }

  /**
   * Puts a trip's travellers into a chunk at (x, y), once per transaction. A full chunk takes none
   * of them and answers with count 0, so the client keeps the whole group queued and retries.
   */
  private arrive(connection: Connection | null, message: ArriveMessage) {
    const reply = (count: number) =>
      (connection?.transport ?? this.connections[0]?.transport)?.send(
        encodeArrived(message.txn, message.space, message.cx, message.cy, count)
      );
    const applied = this.arrivals.get(message.txn);
    if (applied !== undefined) {
      reply(applied);
      return;
    }
    const chunk = this.chunks.get(spaceChunkKey(message.space, message.cx, message.cy));
    if (!chunk) {
      this.log(1, `Trip ${message.txn} arrived for a chunk this host doesn't hold`);
      reply(0);
      return;
    }
    const world = chunk.world;
    if (world.size - world.entitySparseSet.dense.length < message.count) {
      reply(0);
      return;
    }
    const [xs, ys] = this.positionColumns(world);
    const { added } = putRows(world, this.module.components, message.rows, message.count);
    for (const eid of added) {
      const dx = message.x - xs[eid];
      const dy = message.y - ys[eid];
      xs[eid] = message.x;
      ys[eid] = message.y;
      this.module.arrived?.(world, eid, dx, dy);
    }
    this.arrivals.set(message.txn, added.length);
    this.trackDirty = true;
    this.noteArrivals(chunk, added);
    reply(added.length);
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
