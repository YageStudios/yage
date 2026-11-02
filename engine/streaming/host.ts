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
 *
 * Lockstep (Op.Lockstep, protocol v6) makes a run a pure function of its chunks and what the
 * client sends, wherever chunks run and whenever messages arrive:
 * - The client sets a tick limit (Op.Limit) the host never runs past, and stamps each message that
 *   changes the simulation with the tick it applies at (Op.At, never below the limit it set), so a
 *   message lands on the same tick however late it arrives. Stamped Tier sets which chunks step
 *   hot; a plain Tier only chooses what is sent to that client.
 * - Hand-offs and the module's posts (ChunkModule.post) apply `lead` ticks after the tick they are
 *   made, on whichever host has the chunk, sorted by source chunk and order made; a host's own
 *   hand-offs take the same road as a peer's. A host closes each tick with Done to every peer and
 *   runs tick t only once every peer has finished t - lead, so nothing it needs can still be on
 *   the way.
 * - Chunks step in key order, ticks are never skipped (a slow host slows the clock), and walking
 *   into a chunk the module doesn't simulate (ChunkModule.simulates) always bounces. A chunk it
 *   doesn't simulate is still stepped (for whoever watches it) but sealed: nobody walks out of it
 *   and its posts are dropped, so when the view loads or drops it changes nothing simulated.
 * Trips (Depart / Arrive) are not covered yet.
 *
 * Save (v7) serializes chunks without unloading them, for a checkpoint: stamped in lockstep, a
 * host takes them at the start of the stamped tick, before stepping it, and answers with Saved.
 */
import { deserializeWorld, SerialMode, stepWorld, type Schema, type SystemImpl, type World } from "minecs";
import { deleteWorld, leanWorldType, type LeanWorldSpec, type LeanWorldType } from "../world/lean";
import { saveWorld } from "../world/save";
import { chunkHash, chunkX, chunkY, spaceChunkKey } from "./coord";
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
  encodeExited,
  encodeSurveyed,
  encodeTransfer,
  encodeUnloaded,
  encodeSaved,
  NO_HOST,
  Op,
  PROTOCOL_VERSION,
  Tier,
  type ArriveMessage,
  encodeDone,
  encodePost,
  PostKind,
  type LocateEntry,
  type Message,
  type PendingPost,
  type SavedChunk,
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
  /**
   * Lockstep: what a post made now waits before it lands (ChunkModule.post); 0 or absent when the
   * host runs free. Anything shared between chunks must go through posts while it is set.
   */
  lead?: number;
  /** A shadow host's step (ChunkHostOptions.shadow): presentation, never the run's. */
  shadow?: boolean;
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
  /** Lockstep: as StepContext.lead. */
  lead?: number;
  /** As StepContext.shadow. */
  shadow?: boolean;
};

/**
 * Runs a chunk world's systems for one step. A hot step (one tick) is one frame on the run's clock:
 * the world's frame is the host tick, so a system's frameMod/frameModOffset lands on the same ticks on
 * every host and after any reload. A warm step already covers several ticks, so every system runs
 * once, scheduled or not. ChunkModule.step calls this, not stepWorld.
 */
export const stepChunkWorld = (world: World, ctx: StepContext) => {
  if (ctx.ticks <= 1) {
    world.frame = ctx.tick - 1;
    stepWorld(world);
    return;
  }
  world.frame = ctx.tick;
  // minecs' step list: world.systems in run order, past the manual (negative depth) ones.
  for (const system of world.systems) {
    const type = system.constructor as typeof SystemImpl;
    if (type.depth < 0) continue;
    if (type.runEmpty || system.query(world).length) system.runAll(world);
  }
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
   * `init` is what the client generated it with (ChunkPool.generate), if anything: the game's own
   * account of what the chunk holds now (e.g. who of its people are ill), for a chunk born mid-run.
   */
  generate(seed: number, cx: number, cy: number, space: number, init?: Uint8Array): World;
  /**
   * The shape of loaded chunk worlds: `load` deserializes into a lean world registering only these
   * components and systems (a `yage/world/lean` spec or leanWorldType). Without it, loaded worlds
   * register every loaded @Component and @System. Make `generate` use the same type.
   */
  world?: LeanWorldSpec | LeanWorldType;
  /** Turns saved chunk bytes into a world. Wins over `world`. */
  deserialize?(bytes: Uint8Array, cx: number, cy: number, space: number): World;
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
   * The work can live in systems: a named stack (yage/world/stacks) the hook runs with runStack.
   */
  overlay?(world: World, snapshot: Snapshot): Uint8Array | null;
  /** Small per-chunk stats (population, counts…) sent after each step. */
  stats?(world: World): Uint8Array;
  /** Game configuration broadcast to every chunk (e.g. evolution traits). */
  configure?(bytes: Uint8Array): void;
  /** Applies the latest input for a controlled entity; called before each step of its chunk. */
  input?(world: World, eid: number, bytes: Uint8Array, ctx: StepContext): void;
  /** A one-byte state for a tracked entity's Locate entry. */
  describe?(world: World, eid: number, controlled: boolean): number;
  /** Static per-chunk data (e.g. terrain) sent once when a client first watches a chunk. */
  staticData?(world: World, cx: number, cy: number, space: number): Uint8Array;
  /** Called when an entity was kept inside its chunk because no neighbour could take it. */
  bounced?(world: World, eid: number): void;
  /**
   * Called after a chunk's world is generated or loaded, with the host's current tick. A module
   * whose state is a function of time uses it to bring the chunk up to date (e.g. put people
   * where their schedules say they are now) instead of simulating the time it was away.
   * The catch-up can live in systems: a named stack (yage/world/stacks) the hook runs with runStack.
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
  /**
   * Lockstep: bytes every host receives (`receive`), made after this chunk's step, e.g. what it
   * added to state shared across chunks. Null sends nothing.
   */
  post?(world: World, ctx: StepContext): Uint8Array | null;
  /** Lockstep: a chunk's post, at the start of the tick `lead` after it was made, in source-chunk order. */
  receive?(bytes: Uint8Array, tick: number): void;
  /**
   * Lockstep: what posts (`receive`) have built up on this host, which every host holds alike, as
   * bytes for a checkpoint (taken at the start of a tick, between steps); null when there is none.
   */
  saveShared?(): Uint8Array | null;
  /** Lockstep: a checkpoint's `saveShared` bytes, given back before the host runs its first tick. */
  loadShared?(bytes: Uint8Array): void;
  /**
   * Runs the host in lockstep from the start, with this lead (ticks between a hand-off or post
   * and the tick it applies at, at least 1), held at tick 0 until the client's first Limit.
   */
  lockstep?: number;
  /**
   * Lockstep: the chunks entities may walk into; walking anywhere else bounces, loaded or not.
   * Any other chunk is sealed: its people bounce at its edges and its posts are dropped. Defaults to all.
   */
  simulates?(space: number, cx: number, cy: number): boolean;
  /**
   * Lockstep: people walking into a chunk it simulates that no host has leave for the client
   * (Exited) instead of bouncing; the client holds them as the game's own (e.g. a coarser tier).
   */
  exits?: boolean;
  /** A client's Command for a loaded chunk, on its stamped tick (the game's own bytes). */
  command?(world: World, bytes: Uint8Array, tick: number): void;
  /** What the game knows of a chunk without making it (a Survey's answer): a pure function of the seed. */
  survey?(seed: number, cx: number, cy: number, space: number): Uint8Array;
}

/** A hand-off or module post waiting for its tick. */
type Post = { kind: PostKind; source: number; seq: number; bytes: Uint8Array };

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
  /**
   * Queue Generate requests and work through them one per task, chunks a client watches hot
   * first, so ticks (and the hot chunks' snapshots and locations) run between slow generates
   * instead of after the whole queue. A queued chunk anything else needs (a transfer, an
   * arrival, an unload) is generated on the spot. Off: each is generated as it arrives.
   */
  deferGenerates?: boolean;
  /**
   * A shadow host (yage/streaming/shadow.ts): a viewer's own island of chunks, simulated for show
   * beside a run it never touches. It has no peers; people walking out of the island leave for its
   * client (Exited) whatever the module's `exits`; its contexts say `shadow`, so the module can key
   * its draws apart. Its client is the island's driver, never the run's pool.
   */
  shadow?: boolean;
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
  /**
   * How fast the clock runs against wall time (Op.Speed): 1 real time, 2 twice as fast, 0 paused.
   * Only the tick rate changes; each tick still covers 1 / tickRate seconds of game time.
   */
  speed = 1;
  /** Lockstep (Op.Lockstep): hand-offs and posts apply this many ticks after they're made; 0 is off. */
  lead = 0;
  /** In lockstep, the first tick this host may not run yet (Op.Limit). */
  limit = 0;
  /** In lockstep, the client messages stamped for each tick (Op.At), in arrival order. */
  private readonly stamped = new Map<number, { connection: Connection | null; bytes: Uint8Array }[]>();
  /** In lockstep, the posts to apply at each tick, this host's and its peers'. */
  private readonly posts = new Map<number, Post[]>();
  /** In lockstep, the last tick each peer finished (Op.Done). */
  private readonly peerDone = new Map<number, number>();
  /** The tick this host's clock started at (Op.Resume): every peer counts as having finished the ticks before it. */
  private startTick = 0;
  /** In lockstep, the chunks stepped hot (stamped Tier). */
  private readonly simHot = new Set<number>();
  /** In lockstep, each chunk's next post number this tick. */
  private readonly seqs = new Map<number, number>();
  /** Chunks in key order (lockstep steps them so), rebuilt when chunks come or go. */
  private ordered: Chunk[] | null = null;
  /** The tick being run, while it runs. */
  private running = -1;
  /** The tick loop, parked while lockstep holds the host; a Limit or Done wakes it. */
  private parked: (() => void) | null = null;
  /** Trip transactions already applied here, so a repeated Arrive adds nobody. */
  private readonly arrivals = new Map<number, number>();
  /** Generate requests not yet run (`deferGenerates`), in arrival order. */
  readonly pending = new Map<number, { cx: number; cy: number; seed: number; space: number; init?: Uint8Array }>();
  private draining: ReturnType<typeof setTimeout> | null = null;
  private readonly deferGenerates: boolean;
  readonly shadow: boolean;

  constructor(readonly module: ChunkModule, options: ChunkHostOptions = {}) {
    this.deferGenerates = !!options.deferGenerates;
    this.shadow = !!options.shadow;
    this.lead = module.lockstep ?? 0;
    if (options.autoTick) this.start();
  }

  /** Generates a queued chunk now (something needs it). */
  private need(key: number) {
    const request = this.pending.get(key);
    if (!request) return;
    this.pending.delete(key);
    this.generate(request.cx, request.cy, request.seed, request.space, request.init);
  }

  /** Runs the next queued generate: the first one a client watches hot, else the oldest. */
  generateNext() {
    let next: number | undefined;
    for (const key of this.pending.keys()) {
      if (this.isHot(key)) {
        next = key;
        break;
      }
      next ??= key;
    }
    if (next !== undefined) this.need(next);
    return this.pending.size;
  }

  private drain() {
    if (this.draining !== null) return;
    this.draining = setTimeout(() => {
      this.draining = null;
      if (this.generateNext()) this.drain();
    }, 0);
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
    if (this.shadow) throw new Error("ChunkHost: a shadow host has no peers");
    this.peers.set(index, transport);
    transport.onMessage((bytes) => {
      if (bytes[0] === Op.Done || bytes[0] === Op.Post) this.receivePeer(index, bytes);
      else this.receive(null, bytes);
    });
  }

  start() {
    if (this.timer) return;
    let interval = 1000 / this.module.tickRate;
    let due = performance.now();
    let speed = this.speed;
    const loop = () => {
      if (this.speed !== speed) {
        // A new speed starts from now: no burst of catch-up ticks, no skipped ones.
        speed = this.speed;
        due = performance.now();
      }
      if (speed <= 0) {
        // Paused: nothing steps, nothing is skipped; resume where it stopped.
        this.timer = setTimeout(loop, 50);
        return;
      }
      interval = 1000 / (this.module.tickRate * speed);
      if (!this.canTick()) {
        // Held by the campaign clock: wait for the slow host instead of skipping ahead.
        due = performance.now() + interval;
        if (this.lead > 0) {
          // Held by lockstep: the Limit or Done that frees it wakes the loop at once.
          this.parked = () => {
            this.parked = null;
            if (this.timer) clearTimeout(this.timer);
            due = Math.max(due, performance.now());
            this.timer = setTimeout(loop, Math.max(0, due - performance.now()));
          };
          this.timer = setTimeout(loop, 50);
          return;
        }
        this.timer = setTimeout(loop, interval);
        return;
      }
      this.tick();
      due += interval;
      const now = performance.now();
      // In lockstep a tick is never skipped: behind, the clock slows instead.
      if (this.lead > 0 && due < now - interval) due = now;
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
    if (this.draining !== null) clearTimeout(this.draining);
    this.draining = null;
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
        if (this.deferGenerates && !this.chunks.has(spaceChunkKey(message.space, message.cx, message.cy))) {
          this.pending.set(spaceChunkKey(message.space, message.cx, message.cy), { ...message, init: message.init.slice() });
          this.drain();
        } else this.generate(message.cx, message.cy, message.seed, message.space, message.init);
        break;
      case Op.Load:
        this.pending.delete(spaceChunkKey(message.space, message.cx, message.cy));
        this.load(message.cx, message.cy, message.bytes, message.space);
        break;
      case Op.Unload: {
        this.need(spaceChunkKey(message.space, message.cx, message.cy));
        const bytes = this.unload(message.cx, message.cy, message.space);
        if (bytes && connection) connection.transport.send(encodeUnloaded(message.cx, message.cy, bytes, message.space), true);
        break;
      }
      case Op.Save: {
        const chunks: SavedChunk[] = [];
        for (const { space, cx, cy } of message.chunks) {
          const key = spaceChunkKey(space, cx, cy);
          this.need(key);
          const chunk = this.chunks.get(key);
          if (chunk) chunks.push({ space, cx, cy, bytes: this.serialize(chunk) });
        }
        // Inside a tick, a stamped Save runs before anything of it has (the tick is already counted).
        const tick = this.running >= 0 ? this.running : this.tickCount;
        // In lockstep, what posts built up here and the posts made before this tick still to land
        // (a peer that already ran it may have sent this host later ones: those are made again).
        const shared = this.lead > 0 ? this.module.saveShared?.() ?? null : null;
        const posts: PendingPost[] = [];
        if (this.lead > 0)
          for (const [at, list] of this.posts)
            if (at >= tick && at < tick + this.lead) for (const post of list) posts.push({ tick: at, ...post });
        connection?.transport.send(encodeSaved(message.id, tick, chunks, shared ?? new Uint8Array(0), posts), true);
        break;
      }
      case Op.Restore:
        // Before the first tick (a checkpoint's load): the shared state, then the posts still to land.
        if (this.tickCount !== this.startTick || this.running >= 0) {
          this.log(2, `Lockstep: Restore after the host has run (now ${this.tickCount}); ignored`);
          break;
        }
        if (message.shared.byteLength) this.module.loadShared?.(message.shared.slice());
        for (const { tick, ...post } of message.posts) this.queuePost(tick, { ...post, bytes: post.bytes.slice() });
        break;
      case Op.Tier:
        if (connection) this.subscribe(connection, message.space, message.cx, message.cy, message.tier, message.snapshotEvery);
        break;
      case Op.Lockstep:
        this.lead = message.lead;
        break;
      case Op.Limit:
        this.limit = Math.max(this.limit, message.tick);
        this.parked?.();
        break;
      case Op.Resume:
        this.resume(message.tick);
        break;
      case Op.At: {
        if (message.tick < this.tickCount) {
          this.log(2, `Lockstep: a message for tick ${message.tick} came after it ran (now ${this.tickCount}); applied now`);
          this.applyStamped(connection, message.bytes);
          break;
        }
        let list = this.stamped.get(message.tick);
        if (!list) this.stamped.set(message.tick, (list = []));
        list.push({ connection, bytes: message.bytes.slice() });
        // For the tick an idle host runs next: nothing it simulates comes between, so it applies now
        // (what came before it first), as at the tick's start. A world generated before the first tick
        // is then there before it, while the client holds the hosts at their start.
        if (message.tick === this.tickCount && this.running < 0) {
          this.stamped.delete(message.tick);
          for (const { connection, bytes } of list) this.applyStamped(connection, bytes);
        }
        break;
      }
      case Op.Speed:
        this.speed = message.speed;
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
        } else {
          // A newly controlled entity is found where it is now, even in a chunk that arrived before its input.
          if (!this.inputs.has(message.gid)) this.trackDirty = true;
          this.inputs.set(message.gid, message.bytes.slice());
        }
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
      case Op.Enter:
        this.enter(message);
        break;
      case Op.Survey: {
        const bytes = this.module.survey?.(message.seed, message.cx, message.cy, message.space) ?? new Uint8Array(0);
        connection?.transport.send(encodeSurveyed(message.space, message.cx, message.cy, bytes), true);
        break;
      }
      case Op.Command: {
        const chunk = this.chunks.get(spaceChunkKey(message.space, message.cx, message.cy));
        if (chunk) this.module.command?.(chunk.world, message.bytes.slice(), this.running >= 0 ? this.running : this.tickCount);
        else this.log(2, `Command for chunk ${message.cx},${message.cy} that isn't here; dropped`);
        break;
      }
      default:
        this.log(1, `Host ignored op ${message.op}`);
    }
  }

  /** A peer's lockstep message: a post to queue for its tick, or the end of one of its ticks. */
  private receivePeer(index: number, bytes: Uint8Array) {
    const message = decodeMessage(bytes);
    if (message.op === Op.Done) {
      this.peerDone.set(index, Math.max(this.peerDone.get(index) ?? -1, message.tick));
      this.parked?.();
    } else if (message.op === Op.Post) {
      if (message.tick < this.tickCount) this.log(2, `Lockstep: a post for tick ${message.tick} came after it ran (now ${this.tickCount})`);
      this.queuePost(message.tick, { kind: message.kind, source: message.source, seq: message.seq, bytes: message.bytes.slice() });
    }
  }

  /**
   * A stamped client message, on its tick: a Tier sets the chunk's simulated tier, a Generate builds
   * the chunk now (never deferred: the tick it is born on is the simulation's), the rest apply as sent.
   */
  private applyStamped(connection: Connection | null, bytes: Uint8Array) {
    if (bytes[0] === Op.Generate) {
      const message = decodeMessage(bytes) as Extract<Message, { op: Op.Generate }>;
      this.pending.delete(spaceChunkKey(message.space, message.cx, message.cy));
      this.generate(message.cx, message.cy, message.seed, message.space, message.init);
      return;
    }
    if (bytes[0] !== Op.Tier) {
      this.receive(connection, bytes);
      return;
    }
    const message = decodeMessage(bytes) as Extract<Message, { op: Op.Tier }>;
    const key = spaceChunkKey(message.space, message.cx, message.cy);
    if (message.tier === Tier.Hot) this.simHot.add(key);
    else this.simHot.delete(key);
  }

  private queuePost(tick: number, post: Post) {
    let list = this.posts.get(tick);
    if (!list) this.posts.set(tick, (list = []));
    list.push(post);
  }

  /**
   * Posts `bytes` from chunk `source` (made on the running tick) for `lead` ticks on: to the host
   * that has chunk `to`, or with `to` null to every host, this one included.
   */
  private post(kind: PostKind, source: number, to: number | null, bytes: Uint8Array) {
    const tick = this.running + this.lead;
    const seq = this.seqs.get(source) ?? 0;
    this.seqs.set(source, seq + 1);
    const host = to === null ? null : this.chunks.has(to) ? this.selfIndex : this.route.get(to);
    if (to === null || host === this.selfIndex) this.queuePost(tick, { kind, source, seq, bytes });
    const message = encodePost(tick, kind, source, seq, bytes);
    if (to === null) {
      for (const peer of this.peers.values()) peer.send(message);
      return;
    }
    if (host === this.selfIndex) return;
    const peer = host === undefined || host === null ? undefined : this.peers.get(host);
    if (peer) peer.send(message, true);
    else this.log(2, `Lockstep: no link to the host of chunk ${to}; a hand-off was lost`);
  }

  /** The posts for `tick`, in source-chunk order: hand-offs land, module posts reach the module. */
  private applyPosts(tick: number) {
    const list = this.posts.get(tick);
    if (!list) return;
    this.posts.delete(tick);
    list.sort((a, b) => a.source - b.source || a.seq - b.seq);
    for (const post of list) {
      if (post.kind === PostKind.Module) {
        this.module.receive?.(post.bytes, tick);
        continue;
      }
      const message = decodeMessage(post.bytes) as Extract<Message, { op: Op.Transfer }>;
      this.land(message);
    }
  }

  /** A posted hand-off lands in its chunk; what it can't take goes back, posted like any hand-off. */
  private land(message: Extract<Message, { op: Op.Transfer }>) {
    const { space, cx, cy, fx, fy, returned } = message;
    const key = spaceChunkKey(space, cx, cy);
    const chunk = this.chunks.get(key);
    const back = (count: number, rows: Uint8Array) => {
      const origin = spaceChunkKey(space, fx, fy);
      const upstream = this.connections[0]?.transport;
      // A view can cool both ends while this hand-off is in flight. Its rows still use the origin's frame.
      if ((this.module.exits || this.shadow) && !this.chunks.has(origin) && !this.route.has(origin) && upstream) {
        upstream.send(encodeExited({ tick: this.running, space, cx: fx, cy: fy, fx, fy, count, rows }), true);
      } else if (returned) this.dropped += count;
      else this.post(PostKind.Transfer, key, origin, encodeTransfer(fx, fy, fx, fy, true, count, rows, space));
    };
    if (!chunk) {
      back(message.count, message.rows);
      return;
    }
    const size = this.module.chunkSize;
    const dx = (fx - cx) * size;
    const dy = (fy - cy) * size;
    const [xs, ys] = this.positionColumns(chunk.world);
    const { added, rejected, rejectedCount } = putRows(chunk.world, this.module.components, message.rows, message.count, (_, eid) => {
      xs[eid] += dx;
      ys[eid] += dy;
    });
    if (this.module.arrived) for (const eid of added) this.module.arrived(chunk.world, eid, dx, dy);
    if (returned) for (const eid of added) this.bounce(chunk.world, eid);
    this.noteArrivals(chunk, added);
    if (rejectedCount) back(rejectedCount, rejected);
  }

  /** A client's Enter: people into a loaded chunk; what it can't take (or a chunk that isn't here) is dropped. */
  private enter(message: Extract<Message, { op: Op.Enter }>) {
    const { space, cx, cy, fx, fy, count, rows } = message;
    const chunk = this.chunks.get(spaceChunkKey(space, cx, cy));
    if (!chunk) {
      this.dropped += count;
      this.log(2, `Enter for chunk ${cx},${cy} that isn't here; ${count} dropped`);
      return;
    }
    const size = this.module.chunkSize;
    const dx = (fx - cx) * size;
    const dy = (fy - cy) * size;
    const [xs, ys] = this.positionColumns(chunk.world);
    const { added, rejectedCount } = putRows(chunk.world, this.module.components, rows, count, (_, eid) => {
      xs[eid] += dx;
      ys[eid] += dy;
    });
    if (this.module.arrived) for (const eid of added) this.module.arrived(chunk.world, eid, dx, dy);
    this.noteArrivals(chunk, added);
    this.dropped += rejectedCount;
  }

  /**
   * Lockstep: a host that hasn't run a tick runs `tick` next, as if it and its peers had run every
   * tick before it (a checkpoint's worker tick). Its chunks step from there as if just loaded, and
   * what was stamped for the ticks it skips applies now, in tick order. A host that has run refuses.
   */
  private resume(tick: number) {
    if (this.tickCount !== 0 || this.startTick !== 0 || this.running >= 0) {
      this.log(2, `Lockstep: Resume at ${tick} after the host has run (now ${this.tickCount}); ignored`);
      return;
    }
    const skipped = [...this.stamped.keys()].filter((at) => at < tick).sort((a, b) => a - b);
    this.tickCount = this.startTick = tick;
    this.limit = Math.max(this.limit, tick);
    for (const at of skipped) {
      const list = this.stamped.get(at)!;
      this.stamped.delete(at);
      for (const { connection, bytes } of list) this.applyStamped(connection, bytes);
    }
    for (const chunk of this.chunks.values()) chunk.lastStep = -1;
    this.parked?.();
  }

  /** Lockstep: the rows handed to this host's chunks that haven't landed yet. */
  inFlight(): number {
    let rows = 0;
    for (const list of this.posts.values())
      for (const post of list) if (post.kind === PostKind.Transfer) rows += (decodeMessage(post.bytes) as Extract<Message, { op: Op.Transfer }>).count;
    return rows;
  }

  private inOrder(): Chunk[] {
    return (this.ordered ??= [...this.chunks.values()].sort((a, b) => a.key - b.key));
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

  generate(cx: number, cy: number, seed: number, space = 0, init?: Uint8Array) {
    const key = spaceChunkKey(space, cx, cy);
    if (!this.chunks.has(key)) {
      const world = this.module.generate(seed, cx, cy, space, init?.byteLength ? init.slice() : undefined);
      this.addChunk(space, cx, cy, world);
      this.module.restored?.(world, { tick: this.tickCount, space, cx, cy, generated: true, lead: this.lead, shadow: this.shadow || undefined });
    }
    this.ready(key);
    // Watched hot while it was queued: its static data could not go out then.
    for (const connection of this.connections) {
      const sub = connection.subscriptions.get(key);
      if (sub) this.subscribe(connection, space, cx, cy, sub.tier, sub.snapshotEvery);
    }
  }

  load(cx: number, cy: number, bytes: Uint8Array, space = 0) {
    const key = spaceChunkKey(space, cx, cy);
    const existing = this.chunks.get(key);
    if (existing) deleteWorld(existing.world);
    const world = this.deserializeChunk(bytes, cx, cy, space);
    this.addChunk(space, cx, cy, world);
    this.module.restored?.(world, { tick: this.tickCount, space, cx, cy, generated: false, lead: this.lead, shadow: this.shadow || undefined });
    this.ready(key);
  }

  private chunkWorldType?: LeanWorldType;

  private deserializeChunk(bytes: Uint8Array, cx: number, cy: number, space: number): World {
    if (this.module.deserialize) return this.module.deserialize(bytes, cx, cy, space);
    const spec = this.module.world;
    if (!spec) return deserializeWorld(bytes.slice().buffer) as World;
    this.chunkWorldType ??= "deserialize" in spec ? spec : leanWorldType(spec);
    return this.chunkWorldType.deserialize(bytes.slice().buffer);
  }

  unload(cx: number, cy: number, space = 0): Uint8Array | null {
    const key = spaceChunkKey(space, cx, cy);
    const chunk = this.chunks.get(key);
    if (!chunk) return null;
    const payload = this.serialize(chunk);
    deleteWorld(chunk.world);
    this.chunks.delete(key);
    this.ordered = null;
    this.route.delete(key);
    for (const connection of this.connections) connection.sentStatic.delete(key);
    return payload;
  }

  /** A chunk's world as bytes, as Unload sends it and Load takes it. */
  private serialize(chunk: Chunk): Uint8Array {
    return new Uint8Array(saveWorld(SerialMode.BINARY, chunk.world));
  }

  private addChunk(space: number, cx: number, cy: number, world: World) {
    const key = spaceChunkKey(space, cx, cy);
    this.chunks.set(key, { key, space, cx, cy, world, phase: chunkHash(cx, cy, space) % this.module.warmEvery, lastStep: -1 });
    this.ordered = null;
    this.route.set(key, this.selfIndex);
    this.trackDirty = true;
  }

  private ready(key: number) {
    const chunk = this.chunks.get(key);
    if (!chunk) throw new Error("ChunkHost: ready chunk is missing");
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
    if (this.lead > 0) {
      if (this.tickCount >= this.limit) return false;
      for (const index of this.peers.keys()) if (Math.max(this.peerDone.get(index) ?? -1, this.startTick - 1) < this.tickCount - this.lead) return false;
      return true;
    }
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
    const lockstep = this.lead > 0;
    if (lockstep) {
      this.running = tick;
      this.seqs.clear();
      const stamped = this.stamped.get(tick);
      this.stamped.delete(tick);
      for (const { connection, bytes } of stamped ?? []) this.applyStamped(connection, bytes);
      this.applyPosts(tick);
    }

    for (const chunk of lockstep ? this.inOrder() : this.chunks.values()) {
      const hot = lockstep ? this.simHot.has(chunk.key) : this.isHot(chunk.key);
      if (!hot && (tick + chunk.phase) % warmEvery !== 0) continue;
      // Normally 1 (hot) or warmEvery (warm); more when the clock skipped ticks or a slot was missed.
      const ticks = Math.max(hot ? 1 : warmEvery, chunk.lastStep < 0 ? 0 : tick - chunk.lastStep);
      chunk.lastStep = tick;
      const ctx: StepContext = { tick, ticks, dt: ticks / tickRate, hot, space: chunk.space, cx: chunk.cx, cy: chunk.cy, lead: this.lead };
      if (this.shadow) ctx.shadow = true;
      this.applyInputs(chunk, ctx);
      this.module.step(chunk.world, ctx);
      this.depart(chunk, ctx);
      if (lockstep) {
        // Drained either way: what a sealed chunk queued must not ride out on the next one's post.
        const bytes = this.module.post?.(chunk.world, ctx);
        if (bytes && !this.sealed(chunk)) this.post(PostKind.Module, chunk.key, null, bytes);
      }
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
    if (lockstep) {
      for (const peer of this.peers.values()) peer.send(encodeDone(tick));
      this.running = -1;
    }
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
      const chunk = this.chunks.get(location.key);
      if (!chunk) throw new Error("ChunkHost: located entity's chunk is missing");
      const [xs, ys] = this.positionColumns(chunk.world);
      entries.push({
        gid,
        space: chunk.space,
        cx: chunk.cx,
        cy: chunk.cy,
        x: xs[location.eid],
        y: ys[location.eid],
        tint: this.module.describe?.(chunk.world, location.eid, this.inputs.has(gid)) ?? 0,
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
      const pending = remaining.get(snapshot);
      if (pending === undefined) throw new Error("ChunkHost: snapshot send count is missing");
      const left = pending - 1;
      remaining.set(snapshot, left);
      connection.transport.send(snapshot.bytes, left === 0);
    }
    for (const [connection, bytes] of overlaySends) connection.transport.send(bytes, false);
  }

  // -------------------------------------------------------------------------------------------
  // Hand-off

  /** Lockstep: a loaded chunk the module doesn't simulate (see ChunkModule.simulates). */
  private sealed(chunk: Chunk) {
    return !!this.module.simulates && !this.module.simulates(chunk.space, chunk.cx, chunk.cy);
  }

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
      if (this.lead > 0) {
        const host = this.chunks.has(target) || this.pending.has(target) ? this.selfIndex : this.route.get(target);
        const into = !this.module.simulates || this.module.simulates(chunk.space, tx, ty);
        const upstream = this.connections[0]?.transport;
        if (!this.sealed(chunk) && into && (host === undefined || host === NO_HOST) && (this.module.exits || this.shadow) && upstream) {
          const rows = takeRows(world, components, eids);
          upstream.send(encodeExited({ tick: this.running, space: chunk.space, cx: tx, cy: ty, fx: chunk.cx, fy: chunk.cy, count: eids.length, rows }), true);
          continue;
        }
        if (this.sealed(chunk) || !into || host === undefined || host === NO_HOST) {
          for (const eid of eids) this.bounce(world, eid);
          continue;
        }
        this.need(target);
        const rows = takeRows(world, components, eids);
        this.post(PostKind.Transfer, chunk.key, target, encodeTransfer(tx, ty, chunk.cx, chunk.cy, false, eids.length, rows, chunk.space));
        continue;
      }
      this.need(target);
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
    this.need(key);
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
    this.need(spaceChunkKey(message.space, message.cx, message.cy));
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
export const runChunkHostWorker = (module: ChunkModule, options: Pick<ChunkHostOptions, "shadow"> = {}) => {
  const host = new ChunkHost(module, { deferGenerates: true, ...options });
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
