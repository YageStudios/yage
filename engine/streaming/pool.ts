/**
 * ChunkPool is the client side of the chunk protocol. It decides which host runs each chunk,
 * keeps every host's routing table current, forwards hand-offs between hosts that have no direct
 * link, and turns host messages into events. The game never needs to know where a chunk runs:
 * local workers, a remote server or a mix look the same.
 */
import { chunkKey, chunkX, chunkY } from "./coord";
import {
  decodeMessage,
  encodeConfig,
  encodeGenerate,
  encodeInput,
  encodeLoad,
  encodeRoute,
  encodeTier,
  encodeTrack,
  encodeTransfer,
  encodeUnload,
  NO_HOST,
  Op,
  Tier,
  type LocateEntry,
  type RouteEntry,
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
  tick: number;
  chunks: number;
};

export type ChunkState = {
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
  stats?: (entries: StatsEntry[], host: number, tick: number) => void;
  locate?: (entry: LocateEntry, host: number) => void;
  ready?: (chunk: ChunkState) => void;
  staticData?: (cx: number, cy: number, bytes: Uint8Array) => void;
  log?: (level: number, text: string, host: number) => void;
};

export type Placement = (cx: number, cy: number, pool: ChunkPool) => number;

export type LocalPoolOptions = {
  /** Creates one worker that calls `runChunkHostWorker` with the game's module. */
  createWorker: () => Worker;
  /** Defaults to hardwareConcurrency - 1, at least 1. */
  workers?: number;
  placement?: Placement;
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
  private readonly events: ChunkPoolEvents = {};
  private readonly routeChanges = new Map<number, number>();
  private routeFlushQueued = false;
  private readonly unloadWaiters = new Map<number, (bytes: Uint8Array) => void>();
  /** Transfers for chunks that are moving, delivered once the chunk lands. */
  private readonly heldTransfers = new Map<number, Uint8Array[]>();
  private tracked: number[] = [];
  private lastConfig: Uint8Array | null = null;
  placement: Placement;

  constructor(placement: Placement = bandedPlacement(4)) {
    this.placement = placement;
  }

  /** A pool of local workers, linked to each other with direct ports for hand-offs. */
  static local(options: LocalPoolOptions): ChunkPool {
    const count = Math.max(1, options.workers ?? (globalThis.navigator?.hardwareConcurrency ?? 4) - 1);
    const pool = new ChunkPool(options.placement);
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
    const handle: ChunkHostHandle = { index: this.hosts.length, transport, kind, busyMs: 0, tick: 0, chunks: 0 };
    this.hosts.push(handle);
    transport.onMessage((bytes) => this.receive(handle, bytes));
    // Tell the host its index before anything else.
    transport.send(encodeRoute(handle.index, []));
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

  generate(cx: number, cy: number, seed: number, host = this.placement(cx, cy, this)) {
    const key = chunkKey(cx, cy);
    if (this.chunks.has(key)) return this.chunks.get(key)!;
    const state: ChunkState = {
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
    this.hosts[host].chunks++;
    this.setRoute(key, host);
    this.flushRoutes();
    this.hosts[host].transport.send(encodeGenerate(cx, cy, seed));
    return state;
  }

  setTier(cx: number, cy: number, tier: Tier, snapshotEvery = 1) {
    const state = this.chunks.get(chunkKey(cx, cy));
    if (!state) return;
    if (state.tier === tier && state.snapshotEvery === snapshotEvery) return;
    state.tier = tier;
    state.snapshotEvery = snapshotEvery;
    if (!state.moving) this.hosts[state.host].transport.send(encodeTier(cx, cy, tier, snapshotEvery));
  }

  /** Unloads a chunk and resolves with its serialized world. */
  unload(cx: number, cy: number): Promise<Uint8Array> {
    const key = chunkKey(cx, cy);
    const state = this.chunks.get(key);
    if (!state) return Promise.reject(new Error(`Chunk ${cx},${cy} is not loaded`));
    return new Promise((resolve) => {
      this.unloadWaiters.set(key, (bytes) => {
        this.chunks.delete(key);
        this.hosts[state.host].chunks--;
        this.setRoute(key, NO_HOST);
        this.flushRoutes();
        resolve(bytes);
      });
      this.hosts[state.host].transport.send(encodeUnload(cx, cy));
    });
  }

  load(cx: number, cy: number, bytes: Uint8Array, host = this.placement(cx, cy, this)) {
    const key = chunkKey(cx, cy);
    const state: ChunkState = this.chunks.get(key) ?? {
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
    this.hosts[host].chunks++;
    this.setRoute(key, host);
    this.flushRoutes();
    this.hosts[host].transport.send(encodeLoad(cx, cy, bytes));
    return state;
  }

  /** Moves a chunk to another host. Hand-offs into it are held until it lands. */
  async move(cx: number, cy: number, host: number) {
    const key = chunkKey(cx, cy);
    const state = this.chunks.get(key);
    if (!state || state.host === host || state.moving) return;
    state.moving = true;
    this.heldTransfers.set(key, []);
    // Point every host at the pool for this chunk while it moves.
    this.setRoute(key, NO_HOST);
    this.flushRoutes();
    const bytes = await new Promise<Uint8Array>((resolve) => {
      this.unloadWaiters.set(key, resolve);
      this.hosts[state.host].transport.send(encodeUnload(cx, cy));
    });
    this.hosts[state.host].chunks--;
    state.host = host;
    this.hosts[host].chunks++;
    const target = this.hosts[host].transport;
    target.send(encodeLoad(cx, cy, bytes));
    if (state.tier !== Tier.Warm || state.snapshotEvery) target.send(encodeTier(cx, cy, state.tier, state.snapshotEvery));
    for (const message of this.heldTransfers.get(key) ?? []) target.send(message);
    this.heldTransfers.delete(key);
    state.moving = false;
    this.setRoute(key, host);
    this.flushRoutes();
  }

  configure(bytes: Uint8Array) {
    this.lastConfig = bytes.slice();
    for (const host of this.hosts) host.transport.send(encodeConfig(bytes));
  }

  input(gid: number, bytes: Uint8Array) {
    const message = encodeInput(gid, bytes);
    for (const host of this.hosts) host.transport.send(message);
  }

  track(gids: number[]) {
    this.tracked = [...gids];
    const message = encodeTrack(gids);
    for (const host of this.hosts) host.transport.send(message);
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
      if (!this.routeChanges.size) return;
      const entries: RouteEntry[] = [];
      for (const [key, host] of this.routeChanges) entries.push({ cx: chunkX(key), cy: chunkY(key), host });
      this.routeChanges.clear();
      for (const host of this.hosts) host.transport.send(encodeRoute(host.index, entries));
    });
  }

  // -------------------------------------------------------------------------------------------
  // Host messages

  private receive(host: ChunkHostHandle, bytes: Uint8Array) {
    const message = decodeMessage(bytes);
    switch (message.op) {
      case Op.Snapshot:
        this.events.snapshot?.(message.snapshot, host.index);
        break;
      case Op.Stats:
        host.busyMs = message.busyMs;
        host.tick = message.tick;
        if (message.entries.length) this.events.stats?.(message.entries, host.index, message.tick);
        break;
      case Op.Locate:
        for (const entry of message.entries) this.events.locate?.(entry, host.index);
        break;
      case Op.Ready: {
        const state = this.chunks.get(chunkKey(message.cx, message.cy));
        if (state) {
          state.ready = true;
          state.population = message.population;
          this.events.ready?.(state);
        }
        break;
      }
      case Op.Unloaded: {
        const key = chunkKey(message.cx, message.cy);
        const waiter = this.unloadWaiters.get(key);
        this.unloadWaiters.delete(key);
        waiter?.(message.bytes.slice());
        break;
      }
      case Op.Transfer:
        this.forward(message);
        break;
      case Op.Static:
        this.events.staticData?.(message.cx, message.cy, message.bytes);
        break;
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
    const key = chunkKey(message.cx, message.cy);
    const bytes = encodeTransfer(message.cx, message.cy, message.fx, message.fy, message.returned, message.count, message.rows);
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
    const origin = this.chunks.get(chunkKey(message.fx, message.fy));
    if (origin) {
      this.hosts[origin.host].transport.send(
        encodeTransfer(message.fx, message.fy, message.fx, message.fy, true, message.count, message.rows),
        true
      );
    }
  }
}
