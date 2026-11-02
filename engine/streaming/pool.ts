/**
 * ChunkPool is the client side of the chunk protocol. It decides which host runs each chunk,
 * keeps every host's routing table current, forwards hand-offs between hosts that have no direct
 * link, and turns host messages into events. The game never needs to know where a chunk runs:
 * local workers, a remote server or a mix look the same.
 *
 * Chunks are addressed by space and coordinates; every method takes the space last and defaults
 * it to 0, so single-space games never mention it. The pool also keeps the campaign clock (the
 * committed tick every host has completed, see `maxLead`) and owns trip travellers between their
 * Depart and their acknowledged Arrive.
 */
import { chunkX, chunkY, keySpace, spaceChunkKey } from "./coord";
import {
  decodeMessage,
  encodeArrive,
  encodeAt,
  encodeCommit,
  encodeLimit,
  encodeResume,
  encodeRestore,
  encodeLockstep,
  encodeSpeed,
  encodeConfig,
  encodeHello,
  encodeGenerate,
  encodeInput,
  encodeLoad,
  encodeRoute,
  encodeSave,
  encodeTier,
  encodeTrack,
  encodeCommand,
  encodeSurvey,
  encodeEnter,
  encodeTransfer,
  encodeUnload,
  NO_HOST,
  Op,
  PostKind,
  PROTOCOL_VERSION,
  Tier,
  type DepartMessage,
  type ExitedMessage,
  type LocateEntry,
  type OverlayMessage,
  type RouteEntry,
  type SaveAddress,
  type PendingPost,
  type SavedChunk,
  type Snapshot,
  type StatsEntry,
  type TransferMessage,
} from "./protocol";
import { portTransport, type ChunkTransport } from "./transport";

export type ChunkHostHandle = {
  index: number;
  transport: ChunkTransport;
  /** Local hosts can be given more chunks; remote hosts run what the server decides. */
  kind: "local" | "remote";
  /** Milliseconds the host spent on its last tick. */
  busyMs: number;
  /** The last tick the host completed (-1 before its first). */
  tick: number;
  chunks: number;
  /** Protocol version from the host's Hello; null until it answers. */
  version: number | null;
};

/** A save's answer (ChunkPool.save): the chunks, the tick they were taken at the start of, and in lockstep the shared state and pending posts. */
export type SavedState = { tick: number; chunks: SavedChunk[]; shared: Uint8Array | null; posts: PendingPost[] };

export type ChunkState = {
  space: number;
  cx: number;
  cy: number;
  host: number;
  ready: boolean;
  population: number;
  tier: Tier;
  snapshotEvery: number;
  /** Set while the chunk is moving between hosts. */
  moving: boolean;
};

export type ChunkPoolEvents = {
  snapshot?: (snapshot: Snapshot, host: number) => void;
  /** Game-defined bytes that came with a hot chunk's snapshot (ChunkModule.overlay). */
  overlay?: (overlay: OverlayMessage, host: number) => void;
  stats?: (entries: StatsEntry[], host: number, tick: number) => void;
  /** A tracked or controlled entity as `host` found it after stepping `tick`. */
  locate?: (entry: LocateEntry, host: number, tick: number) => void;
  ready?: (chunk: ChunkState) => void;
  staticData?: (cx: number, cy: number, bytes: Uint8Array, space: number) => void;
  log?: (level: number, text: string, host: number) => void;
  /** The committed campaign tick advanced: every host has completed ticks before `tick`. */
  epoch?: (tick: number) => void;
  /** Travellers left a chunk on a trip; the pool holds them until `arrive`. */
  departed?: (trip: HeldTrip) => void;
  /** A trip's arrival was applied (`count` > 0) or refused because the chunk was full (0). */
  arrived?: (txn: number, count: number) => void;
  /** A chunk `unload` asked for is gone, as these bytes: as soon as they come, before its promise settles. */
  unloaded?: (cx: number, cy: number, bytes: Uint8Array, space: number) => void;
  /** Lockstep: people walked into a chunk no host has (ChunkModule.exits); theirs now, as the host's rows. */
  exited?: (exit: ExitedMessage, host: number) => void;
};

/** Travellers in transit: their rows, owned by the pool between Depart and an acknowledged Arrive. */
export type HeldTrip = DepartMessage & {
  /** Arrive sent and not yet acknowledged. */
  sent: boolean;
};

export type Placement = (cx: number, cy: number, pool: ChunkPool, space: number) => number;

export type LocalPoolOptions = {
  /** Creates one worker that calls `runChunkHostWorker` with the game's module. */
  createWorker: () => Worker;
  /** Defaults to hardwareConcurrency - 1, at least 1. */
  workers?: number;
  placement?: Placement;
  /** Lockstep lead (see ChunkHost): set before any host is added, so no host ticks outside it. */
  lockstep?: number;
};

/** Spreads chunks in bands of rows, so most borders are between chunks on the same host. */
export const bandedPlacement =
  (bandRows: number): Placement =>
  (_cx, cy, pool) => {
    const local = pool.hosts.filter((host) => host.kind === "local");
    const list = local.length ? local : pool.hosts;
    const band = Math.floor(cy / bandRows);
    return list[((band % list.length) + list.length) % list.length].index;
  };

export class ChunkPool {
  readonly hosts: ChunkHostHandle[] = [];
  readonly chunks = new Map<number, ChunkState>();
  /** Bumped whenever a chunk is added, removed or becomes ready, so watchers can skip unchanged frames. */
  revision = 0;
  private readonly events: ChunkPoolEvents = {};
  private readonly routeChanges = new Map<number, number>();
  private routeFlushQueued = false;
  private readonly unloadWaiters = new Map<number, (bytes: Uint8Array) => void>();
  private readonly surveyWaiters = new Map<number, ((bytes: Uint8Array) => void)[]>();
  /** Save requests waiting on their hosts' answers, by request id. */
  private readonly saveWaiters = new Map<number, (tick: number, chunks: SavedChunk[], shared: Uint8Array, posts: PendingPost[]) => void>();
  private saveId = 0;
  /** Transfers for chunks that are moving, delivered once the chunk lands. */
  private readonly heldTransfers = new Map<number, Uint8Array[]>();
  private tracked: number[] = [];
  /** The input last sent for each controlled entity (released ones dropped), so a save can send it again. */
  private readonly inputs = new Map<number, Uint8Array>();
  private lastConfig: Uint8Array | null = null;
  /** Trips in transit, by transaction id. */
  readonly trips = new Map<number, HeldTrip>();
  /** Committed campaign tick: every host has completed all ticks before it. */
  committed = 0;
  /** How many ticks a host may run past `committed` (0: unbounded, hosts keep their own time). */
  maxLead = 0;
  placement: Placement;

  constructor(placement: Placement = bandedPlacement(4)) {
    this.placement = placement;
  }

  /** A pool of local workers, linked to each other with direct ports for hand-offs. */
  static local(options: LocalPoolOptions): ChunkPool {
    const count = Math.max(1, options.workers ?? (globalThis.navigator?.hardwareConcurrency ?? 4) - 1);
    const pool = new ChunkPool(options.placement);
    pool.lead = options.lockstep ?? 0;
    const workers = Array.from({ length: count }, () => options.createWorker());
    const peers: { index: number; port: MessagePort }[][] = workers.map(() => []);
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        const channel = new MessageChannel();
        peers[a].push({ index: b, port: channel.port1 });
        peers[b].push({ index: a, port: channel.port2 });
      }
    }
    workers.forEach((worker, index) => {
      worker.postMessage(
        { type: "yage-chunk-peers", peers: peers[index] },
        peers[index].map((peer) => peer.port)
      );
      pool.addHost(portTransport(worker as any), "local");
    });
    return pool;
  }

  /** Adds a host and returns its index. */
  addHost(transport: ChunkTransport, kind: ChunkHostHandle["kind"]) {
    const handle: ChunkHostHandle = { index: this.hosts.length, transport, kind, busyMs: 0, tick: -1, chunks: 0, version: null };
    this.hosts.push(handle);
    transport.onMessage((bytes) => this.receive(handle, bytes));
    // Agree on the protocol, then tell the host its index, before anything else.
    transport.send(encodeHello());
    transport.send(encodeRoute(handle.index, []));
    if (this.maxLead > 0) transport.send(encodeCommit(this.committed, this.maxLead));
    if (this.lead > 0) {
      transport.send(encodeLockstep(this.lead));
      if (this.startTick > 0) transport.send(encodeResume(this.startTick));
      transport.send(encodeLimit(this.limit));
    }
    if (this.speed !== 1) transport.send(encodeSpeed(this.speed));
    if (this.tracked.length) transport.send(encodeTrack(this.tracked));
    if (this.lastConfig) transport.send(encodeConfig(this.lastConfig));
    return handle.index;
  }

  on(events: ChunkPoolEvents) {
    Object.assign(this.events, events);
    return this;
  }

  // -------------------------------------------------------------------------------------------
  // Commands

  /** Generates a chunk, with `init` for the module's generate if given (see ChunkModule.generate). */
  generate(cx: number, cy: number, seed: number, host?: number, space = 0, init?: Uint8Array) {
    const key = spaceChunkKey(space, cx, cy);
    if (this.chunks.has(key)) return this.chunks.get(key)!;
    host ??= this.placement(cx, cy, this, space);
    const state: ChunkState = {
      space,
      cx,
      cy,
      host,
      ready: false,
      population: 0,
      tier: Tier.Warm,
      snapshotEvery: 0,
      moving: false,
    };
    this.chunks.set(key, state);
    this.revision++;
    this.hosts[host].chunks++;
    this.setRoute(key, host);
    this.flushRoutes();
    // In lockstep a chunk is born on a stamped tick, so its clock is the same however it is placed or timed.
    this.hosts[host].transport.send(this.stamp(encodeGenerate(cx, cy, seed, space, init)));
    return state;
  }

  /**
   * Lockstep: whether chunk (cx, cy) steps hot, from the limit's tick on. The simulation's, not a
   * view's: whoever owns the run decides it (e.g. from every player's HotSet), so what a client
   * happens to watch never changes what is simulated. Ignored outside lockstep, where the watched
   * tier decides both.
   */
  setSimTier(cx: number, cy: number, tier: Tier, space = 0) {
    const state = this.chunks.get(spaceChunkKey(space, cx, cy));
    if (!state || this.lead <= 0) return;
    this.hosts[state.host].transport.send(encodeAt(this.limit, encodeTier(cx, cy, tier, 0, space)));
  }

  setTier(cx: number, cy: number, tier: Tier, snapshotEvery = 1, space = 0) {
    const state = this.chunks.get(spaceChunkKey(space, cx, cy));
    if (!state) return;
    if (state.tier === tier && state.snapshotEvery === snapshotEvery) return;
    state.tier = tier;
    state.snapshotEvery = snapshotEvery;
    if (state.moving) return;
    // What this client is sent; in lockstep what steps hot is setSimTier's alone.
    this.hosts[state.host].transport.send(encodeTier(cx, cy, tier, snapshotEvery, space));
  }

  /**
   * Unloads a chunk and resolves with its serialized world. In lockstep it goes on the limit's
   * tick, before the host runs it, with every host's route to it: its world is the chunk as every
   * tick before that one left it, and hand-offs from then on find it gone, however the reply falls.
   */
  unload(cx: number, cy: number, space = 0): Promise<Uint8Array> {
    const key = spaceChunkKey(space, cx, cy);
    const state = this.chunks.get(key);
    if (!state) return Promise.reject(new Error(`Chunk ${cx},${cy} is not loaded`));
    const lockstep = this.lead > 0;
    if (lockstep) {
      this.setRoute(key, NO_HOST);
      this.sendRoutes();
    }
    return new Promise((resolve) => {
      this.unloadWaiters.set(key, (bytes) => {
        this.chunks.delete(key);
        this.revision++;
        this.hosts[state.host].chunks--;
        if (!lockstep) {
          this.setRoute(key, NO_HOST);
          this.flushRoutes();
        }
        this.events.unloaded?.(cx, cy, bytes, space);
        resolve(bytes);
      });
      this.hosts[state.host].transport.send(this.stamp(encodeUnload(cx, cy, space)));
    });
  }

  /**
   * The worlds of loaded chunks as `unload` gives them, without unloading them: for a checkpoint.
   * In lockstep each host takes them at the start of the limit's tick, before running it, so they
   * are the chunks as every tick before it left them; outside lockstep, when each host gets the
   * request. Resolves with them in key order and the (latest) tick they were taken at. Chunks not
   * loaded, or moving, are left out. In lockstep every host answers, with what posts built up on it
   * (ChunkModule.saveShared: the first host's, as every host holds the same) and the posts still to
   * land (each once, in landing order): a load gives both back (`restore`).
   */
  save(chunks: readonly SaveAddress[]): Promise<SavedState> {
    const lockstep = this.lead > 0;
    const byHost = new Map<number, SaveAddress[]>();
    if (lockstep) for (let host = 0; host < this.hosts.length; host++) byHost.set(host, []);
    for (const chunk of chunks) {
      const state = this.chunks.get(spaceChunkKey(chunk.space ?? 0, chunk.cx, chunk.cy));
      if (!state || state.moving) continue;
      let list = byHost.get(state.host);
      if (!list) byHost.set(state.host, (list = []));
      list.push(chunk);
    }
    if (!byHost.size) return Promise.resolve({ tick: lockstep ? this.limit : 0, chunks: [], shared: null, posts: [] });
    const answers = [...byHost].sort(([a], [b]) => a - b).map(
      ([host, list]) =>
        new Promise<{ tick: number; chunks: SavedChunk[]; shared: Uint8Array; posts: PendingPost[] }>((resolve) => {
          const id = ++this.saveId;
          this.saveWaiters.set(id, (tick, saved, shared, posts) => resolve({ tick, chunks: saved, shared, posts }));
          this.hosts[host].transport.send(this.stamp(encodeSave(id, list)), true);
        })
    );
    return Promise.all(answers).then((all) => {
      const posts = new Map<string, PendingPost>();
      for (const answer of all) for (const post of answer.posts) posts.set(`${post.tick}:${post.source}:${post.seq}:${post.kind}`, post);
      return {
        tick: all.reduce((max, a) => Math.max(max, a.tick), 0),
        chunks: all
          .flatMap((a) => a.chunks)
          .sort((a, b) => spaceChunkKey(a.space, a.cx, a.cy) - spaceChunkKey(b.space, b.cx, b.cy)),
        shared: all.find((a) => a.shared.byteLength)?.shared ?? null,
        posts: [...posts.values()].sort((a, b) => a.tick - b.tick || a.source - b.source || a.seq - b.seq || a.kind - b.kind),
      };
    });
  }

  /**
   * Lockstep, on a load after `resume` and the chunks' loads, before the limit moves: a save's shared
   * state to every host, and its pending posts where they land: a module post on every host, a
   * hand-off on the host that has its chunk now (however the chunks are split this time).
   */
  restore(shared: Uint8Array | null, posts: readonly PendingPost[]) {
    if (this.lead <= 0) throw new Error("ChunkPool.restore: lockstep is off");
    const byHost = this.hosts.map((): PendingPost[] => []);
    for (const post of posts) {
      if (post.kind === PostKind.Module) {
        for (const list of byHost) list.push(post);
        continue;
      }
      // A chunk no host has: it lands where it would have, sent back to the chunk it left.
      const transfer = decodeMessage(post.bytes) as TransferMessage;
      const state = this.chunks.get(spaceChunkKey(transfer.space, transfer.cx, transfer.cy)) ?? this.chunks.get(spaceChunkKey(transfer.space, transfer.fx, transfer.fy));
      byHost[state?.host ?? 0].push(post);
    }
    const bytes = shared ?? new Uint8Array(0);
    this.hosts.forEach((host, i) => host.transport.send(encodeRestore(bytes, byHost[i])));
  }

  /**
   * The worlds of loaded chunks as each host has them now, for a look (a shadow island opening on
   * them, yage/streaming/shadow.ts): an unstamped Save, so nothing waits for it and nothing of the
   * simulation changes; each comes with the tick its host was about to run. Chunks not loaded, or
   * moving, are left out. Never for a checkpoint: hosts answer at different ticks.
   */
  peek(chunks: readonly SaveAddress[]): Promise<{ tick: number; chunk: SavedChunk }[]> {
    const byHost = new Map<number, SaveAddress[]>();
    for (const chunk of chunks) {
      const state = this.chunks.get(spaceChunkKey(chunk.space ?? 0, chunk.cx, chunk.cy));
      if (!state || state.moving) continue;
      let list = byHost.get(state.host);
      if (!list) byHost.set(state.host, (list = []));
      list.push(chunk);
    }
    const answers = [...byHost].map(
      ([host, list]) =>
        new Promise<{ tick: number; chunk: SavedChunk }[]>((resolve) => {
          const id = ++this.saveId;
          this.saveWaiters.set(id, (tick, saved) => resolve(saved.map((chunk) => ({ tick, chunk }))));
          this.hosts[host].transport.send(encodeSave(id, list), true);
        })
    );
    return Promise.all(answers).then((all) => all.flat().sort((a, b) => spaceChunkKey(a.chunk.space, a.chunk.cx, a.chunk.cy) - spaceChunkKey(b.chunk.space, b.chunk.cx, b.chunk.cy)));
  }

  /** Loads a chunk from `unload`'s (or `save`'s) bytes; in lockstep it joins on the limit's tick. */
  load(cx: number, cy: number, bytes: Uint8Array, host?: number, space = 0) {
    const key = spaceChunkKey(space, cx, cy);
    const loaded = this.chunks.get(key);
    // A loaded chunk is replaced where it runs (its host's Load swaps the world); `move` changes hosts.
    if (loaded && host !== undefined && host !== loaded.host) throw new Error(`Chunk ${cx},${cy} runs on host ${loaded.host}; move it instead`);
    host ??= loaded?.host ?? this.placement(cx, cy, this, space);
    const state: ChunkState = loaded ?? {
      space,
      cx,
      cy,
      host,
      ready: false,
      population: 0,
      tier: Tier.Warm,
      snapshotEvery: 0,
      moving: false,
    };
    state.host = host;
    this.chunks.set(key, state);
    this.revision++;
    if (!loaded) this.hosts[host].chunks++;
    this.setRoute(key, host);
    this.flushRoutes();
    this.hosts[host].transport.send(this.stamp(encodeLoad(cx, cy, bytes, space)));
    return state;
  }

  /** Moves a chunk to another host. Hand-offs into it are held until it lands. */
  async move(cx: number, cy: number, host: number, space = 0) {
    const key = spaceChunkKey(space, cx, cy);
    const state = this.chunks.get(key);
    if (!state || state.host === host || state.moving) return;
    state.moving = true;
    this.heldTransfers.set(key, []);
    // Point every host at the pool for this chunk while it moves.
    this.setRoute(key, NO_HOST);
    this.flushRoutes();
    const bytes = await new Promise<Uint8Array>((resolve) => {
      this.unloadWaiters.set(key, resolve);
      this.hosts[state.host].transport.send(encodeUnload(cx, cy, space));
    });
    this.hosts[state.host].chunks--;
    state.host = host;
    this.hosts[host].chunks++;
    const target = this.hosts[host].transport;
    target.send(encodeLoad(cx, cy, bytes, space));
    if (state.tier !== Tier.Warm || state.snapshotEvery) target.send(encodeTier(cx, cy, state.tier, state.snapshotEvery, space));
    for (const message of this.heldTransfers.get(key) ?? []) target.send(message);
    this.heldTransfers.delete(key);
    state.moving = false;
    this.setRoute(key, host);
    this.flushRoutes();
  }

  /** In lockstep, `bytes` stamped with the tick it applies at: the limit, the first tick no host has run. */
  private stamp(bytes: Uint8Array) {
    return this.lead > 0 ? encodeAt(this.limit, bytes) : bytes;
  }

  /** The bytes the hosts were last configured with (null: never); a checkpoint keeps them. */
  get configured(): Uint8Array | null {
    return this.lastConfig;
  }

  /** The entities under control and the input last sent for each, in the order they were first sent. */
  get controlled(): ReadonlyMap<number, Uint8Array> {
    return this.inputs;
  }

  /** The entities the hosts are told to track (`track`). */
  get tracking(): readonly number[] {
    return this.tracked;
  }

  configure(bytes: Uint8Array) {
    this.lastConfig = bytes.slice();
    const message = this.stamp(encodeConfig(bytes));
    for (const host of this.hosts) host.transport.send(message);
  }

  /** Sends input for a controlled entity to whichever host holds it; empty bytes release it. */
  input(gid: number, bytes: Uint8Array) {
    if (bytes.byteLength === 0) this.inputs.delete(gid);
    else this.inputs.set(gid, bytes.slice());
    const message = this.stamp(encodeInput(gid, bytes));
    for (const host of this.hosts) host.transport.send(message);
  }

  track(gids: number[]) {
    this.tracked = [...gids];
    const message = encodeTrack(gids);
    for (const host of this.hosts) host.transport.send(message);
  }

  // -------------------------------------------------------------------------------------------
  // Campaign clock

  /** How fast every host's clock runs: 1 real time, 2 twice as fast, 0 paused (see ChunkHost.speed). */
  speed = 1;

  setSpeed(speed: number) {
    this.speed = Math.max(0, speed);
    const message = encodeSpeed(this.speed);
    for (const host of this.hosts) host.transport.send(message);
  }

  /** Lockstep lead (0: off). */
  lead = 0;
  /** In lockstep, the first tick no host may run yet; whatever changes the simulation is stamped with it. */
  limit = 0;

  /** Turns lockstep on (`lead` ≥ 1) for every host; hosts added later join it. */
  setLockstep(lead: number) {
    this.lead = lead;
    for (const host of this.hosts) {
      host.transport.send(encodeLockstep(lead));
      host.transport.send(encodeLimit(this.limit));
    }
  }

  /** The tick lockstep started at (resume); hosts added later start there too. */
  startTick = 0;

  /**
   * Lockstep: before any host has run a tick, starts every host's clock at `tick` (a checkpoint's
   * worker tick), as if all of them had run every tick before it. The limit and the committed tick
   * move there, so what is sent next is stamped for `tick`. Throws once a host has run.
   */
  resume(tick: number) {
    if (this.lead <= 0) throw new Error("ChunkPool.resume: lockstep is off");
    if (this.startTick !== 0 || this.limit !== 0 || this.hosts.some((host) => host.tick >= 0)) throw new Error("ChunkPool.resume: the hosts have already run");
    this.sendRoutes();
    this.startTick = this.limit = this.committed = tick;
    for (const host of this.hosts) host.tick = tick - 1;
    const message = encodeResume(tick);
    for (const host of this.hosts) host.transport.send(message);
  }

  /** Lockstep: lets every host run up to (not including) `tick`. Never goes back. */
  setLimit(tick: number) {
    if (tick <= this.limit) return;
    // Route changes queued under the old limit carry it, as the generates and moves that made them do.
    this.sendRoutes();
    this.limit = tick;
    const message = encodeLimit(tick);
    for (const host of this.hosts) host.transport.send(message);
  }

  /** Bounds how far any host may run past the committed tick (0 lets each keep its own time). */
  setMaxLead(maxLead: number) {
    this.maxLead = maxLead;
    const message = encodeCommit(this.committed, maxLead);
    for (const host of this.hosts) host.transport.send(message);
  }

  /** Every host has completed all ticks before the returned one. */
  private commit() {
    let committed = Infinity;
    for (const host of this.hosts) committed = Math.min(committed, host.tick + 1);
    if (!Number.isFinite(committed) || committed <= this.committed) return;
    this.committed = committed;
    if (this.maxLead > 0) {
      const message = encodeCommit(committed, this.maxLead);
      for (const host of this.hosts) host.transport.send(message);
    }
    this.events.epoch?.(committed);
  }

  // -------------------------------------------------------------------------------------------
  // Trips

  /**
   * Sends a held trip's travellers into chunk (cx, cy) of `space` at chunk-local (x, y). Returns
   * false if the trip is unknown or the chunk isn't loaded. Safe to repeat: the host applies a
   * transaction once, and the pool drops the trip only when the host acknowledges it.
   */
  arrive(txn: number, space: number, cx: number, cy: number, x: number, y: number) {
    const trip = this.trips.get(txn);
    const state = this.chunks.get(spaceChunkKey(space, cx, cy));
    if (!trip || !state || state.moving) return false;
    trip.sent = true;
    this.hosts[state.host].transport.send(this.stamp(encodeArrive(txn, space, cx, cy, x, y, trip.count, trip.rows)));
    return true;
  }

  /**
   * Puts people (rows as Exited gave them, positions relative to chunk (fx, fy)) into chunk (cx, cy),
   * on the limit's tick in lockstep. Returns false if the chunk isn't loaded or on its way.
   */
  enter(space: number, cx: number, cy: number, fx: number, fy: number, count: number, rows: Uint8Array) {
    const state = this.chunks.get(spaceChunkKey(space, cx, cy));
    if (!state || state.moving) return false;
    this.hosts[state.host].transport.send(this.stamp(encodeEnter(space, cx, cy, fx, fy, count, rows)));
    return true;
  }

  /**
   * What the game knows of chunk (cx, cy) without making it (ChunkModule.survey), from the host it
   * would be placed on (or `host`). Not stamped: the answer is a pure function of the seed.
   */
  survey(cx: number, cy: number, seed: number, space = 0, host?: number): Promise<Uint8Array> {
    const key = spaceChunkKey(space, cx, cy);
    host ??= this.placement(cx, cy, this, space);
    return new Promise((resolve) => {
      const waiters = this.surveyWaiters.get(key);
      if (waiters) return void waiters.push(resolve);
      this.surveyWaiters.set(key, [resolve]);
      this.hosts[host].transport.send(encodeSurvey(space, cx, cy, seed));
    });
  }

  /** Sends chunk (cx, cy) the game's own bytes (ChunkModule.command), on the limit's tick in lockstep. Returns false if it isn't loaded or on its way. */
  command(cx: number, cy: number, bytes: Uint8Array, space = 0) {
    const state = this.chunks.get(spaceChunkKey(space, cx, cy));
    if (!state || state.moving) return false;
    this.hosts[state.host].transport.send(this.stamp(encodeCommand(space, cx, cy, bytes)));
    return true;
  }

  /** Trips in transit, for a save. Rows are copied. */
  saveTrips(): DepartMessage[] {
    return [...this.trips.values()].map(({ txn, space, cx, cy, count, rows }) => ({ txn, space, cx, cy, count, rows: rows.slice() }));
  }

  /** Restores trips from a save (replacing any with the same transaction id). */
  restoreTrips(trips: readonly DepartMessage[]) {
    for (const trip of trips) this.trips.set(trip.txn, { ...trip, rows: trip.rows.slice(), sent: false });
  }

  destroy() {
    for (const host of this.hosts) host.transport.close?.();
    this.hosts.length = 0;
    this.chunks.clear();
  }

  // -------------------------------------------------------------------------------------------
  // Routing

  private setRoute(key: number, host: number) {
    this.routeChanges.set(key, host);
  }

  private flushRoutes() {
    if (this.routeFlushQueued) return;
    this.routeFlushQueued = true;
    queueMicrotask(() => {
      this.routeFlushQueued = false;
      this.sendRoutes();
    });
  }

  private sendRoutes() {
    if (!this.routeChanges.size) return;
    const entries: RouteEntry[] = [];
    for (const [key, host] of this.routeChanges) entries.push({ space: keySpace(key), cx: chunkX(key), cy: chunkY(key), host });
    this.routeChanges.clear();
    // In lockstep a route change lands on every host on the same tick, so hand-offs see the same map.
    for (const host of this.hosts) host.transport.send(this.stamp(encodeRoute(host.index, entries)));
  }

  // -------------------------------------------------------------------------------------------
  // Host messages

  private receive(host: ChunkHostHandle, bytes: Uint8Array) {
    const message = decodeMessage(bytes);
    switch (message.op) {
      case Op.Hello:
        host.version = message.version;
        if (message.version !== PROTOCOL_VERSION) {
          const text = `Chunk host ${host.index} speaks protocol v${message.version}; this client speaks v${PROTOCOL_VERSION}`;
          if (this.events.log) this.events.log(2, text, host.index);
          else console.error(text);
        }
        break;
      case Op.Snapshot:
        this.events.snapshot?.(message.snapshot, host.index);
        break;
      case Op.Overlay: {
        const { op: _op, ...overlay } = message;
        this.events.overlay?.(overlay, host.index);
        break;
      }
      case Op.Stats:
        host.busyMs = message.busyMs;
        host.tick = Math.max(host.tick, message.tick);
        if (message.entries.length) this.events.stats?.(message.entries, host.index, message.tick);
        this.commit();
        break;
      case Op.Locate:
        for (const entry of message.entries) this.events.locate?.(entry, host.index, message.tick);
        break;
      case Op.Ready: {
        const state = this.chunks.get(spaceChunkKey(message.space, message.cx, message.cy));
        if (state) {
          state.ready = true;
          this.revision++;
          state.population = message.population;
          this.events.ready?.(state);
        }
        break;
      }
      case Op.Unloaded: {
        const key = spaceChunkKey(message.space, message.cx, message.cy);
        const waiter = this.unloadWaiters.get(key);
        this.unloadWaiters.delete(key);
        waiter?.(message.bytes.slice());
        break;
      }
      case Op.Saved: {
        const waiter = this.saveWaiters.get(message.id);
        this.saveWaiters.delete(message.id);
        waiter?.(
          message.tick,
          message.chunks.map((chunk) => ({ ...chunk, bytes: chunk.bytes.slice() })),
          message.shared.slice(),
          message.posts.map((post) => ({ ...post, bytes: post.bytes.slice() }))
        );
        break;
      }
      case Op.Transfer:
        this.forward(message);
        break;
      case Op.Static:
        this.events.staticData?.(message.cx, message.cy, message.bytes, message.space);
        break;
      case Op.Depart: {
        const { op: _op, ...depart } = message;
        const trip: HeldTrip = { ...depart, rows: depart.rows.slice(), sent: false };
        this.trips.set(trip.txn, trip);
        this.events.departed?.(trip);
        break;
      }
      case Op.Surveyed: {
        const key = spaceChunkKey(message.space, message.cx, message.cy);
        const waiters = this.surveyWaiters.get(key) ?? [];
        this.surveyWaiters.delete(key);
        for (const waiter of waiters) waiter(message.bytes.slice());
        break;
      }
      case Op.Exited: {
        const { op: _op, ...exit } = message;
        this.events.exited?.({ ...exit, rows: exit.rows.slice() }, host.index);
        break;
      }
      case Op.Arrived: {
        const trip = this.trips.get(message.txn);
        if (trip && message.count > 0) this.trips.delete(message.txn);
        else if (trip) trip.sent = false;
        this.events.arrived?.(message.txn, message.count);
        break;
      }
      case Op.Log:
        if (this.events.log) this.events.log(message.level, message.text, host.index);
        else console[message.level >= 2 ? "error" : message.level === 1 ? "warn" : "info"](`[chunk host ${host.index}]`, message.text);
        break;
      default:
        break;
    }
  }

  /** Passes a hand-off on to the host that owns its chunk. */
  private forward(message: TransferMessage) {
    const key = spaceChunkKey(message.space, message.cx, message.cy);
    const bytes = encodeTransfer(message.cx, message.cy, message.fx, message.fy, message.returned, message.count, message.rows, message.space);
    const held = this.heldTransfers.get(key);
    if (held) {
      held.push(bytes);
      return;
    }
    const state = this.chunks.get(key);
    if (state) {
      this.hosts[state.host].transport.send(bytes, true);
      return;
    }
    // Nobody has the destination: send the rows home, where they bounce inside the border.
    if (message.returned) return;
    const origin = this.chunks.get(spaceChunkKey(message.space, message.fx, message.fy));
    if (origin) {
      this.hosts[origin.host].transport.send(
        encodeTransfer(message.fx, message.fy, message.fx, message.fy, true, message.count, message.rows, message.space),
        true
      );
    }
  }
}
