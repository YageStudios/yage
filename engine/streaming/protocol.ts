/**
 * Binary chunk-host protocol.
 *
 * Every message is one byte array whose first byte is the op. The same bytes travel over a worker
 * MessagePort, a WebSocket or a peer DataChannel, so a chunk behaves the same wherever it runs.
 * All numbers are little-endian. Chunk coordinates are int16; every chunk is addressed by a u16
 * space id plus its coordinates (space 0 is the default space, see coord.ts).
 *
 * Version 2 added spaces, the Hello handshake, the campaign Commit clock and cross-space trips
 * (Depart / Arrive / Arrived). ChunkPool sends Hello first; a host on another version answers
 * with its own Hello and an error Log and ignores everything else from that client, and the pool
 * reports a host whose Hello names another version, so mismatched builds fail clearly instead of
 * misreading each other's bytes. A client that never sends Hello (an in-process client of the
 * same build, e.g. a test) is trusted.
 *
 * Version 3 added Overlay: game-defined bytes sent with a hot chunk's snapshot.
 * Version 4 widened snapshot sprite ids to u16 (65535 sprites per style: items, vehicles, cultures).
 */

/** Wire format version. Bump on any layout change. */
export const PROTOCOL_VERSION = 4;

export enum Op {
  // client -> host
  Generate = 1,
  Load = 2,
  Unload = 3,
  Tier = 4,
  Config = 5,
  Input = 6,
  Track = 7,
  Route = 8,
  // host <-> host, or host -> client -> host when no direct link exists
  Transfer = 9,
  /** client -> host: protocol version handshake; host -> client: the host's version. */
  Hello = 10,
  /** client -> host: the committed campaign tick and how far ahead of it a host may run. */
  Commit = 11,
  /** client -> host: entity rows of a trip arriving in a chunk (possibly in another space). */
  Arrive = 12,
  // host -> client
  Snapshot = 20,
  Stats = 21,
  Unloaded = 22,
  Locate = 23,
  Static = 24,
  Log = 25,
  Ready = 26,
  /** host -> client: rows of entities that left their chunk on a trip, held by the client. */
  Depart = 27,
  /** host -> client: a trip's arrival was applied (sent again for a repeated Arrive). */
  Arrived = 28,
  /**
   * host -> client: game-defined bytes sent with a hot chunk's snapshot, for whatever rides along
   * with the entities (load fields, effect events, extra per-slot values…). See ChunkModule.overlay.
   */
  Overlay = 29,
}

/** Positions in snapshots are int16 fixed point: world units × POSITION_SCALE. */
export const POSITION_SCALE = 8;
/** Snapshot tint value for an empty entity slot. */
export const EMPTY_SLOT = 255;
/** `Route` host index meaning the chunk is not loaded anywhere. */
export const NO_HOST = -1;

export enum Tier {
  /** Loaded and simulated at the slow rate; no snapshots. */
  Warm = 0,
  /** Simulated every tick; snapshots every `snapshotEvery` ticks. */
  Hot = 1,
}

export class ByteWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  offset = 0;

  constructor(capacity = 256) {
    this.buffer = new ArrayBuffer(capacity);
    this.view = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
  }

  private ensure(extra: number) {
    const needed = this.offset + extra;
    if (needed <= this.buffer.byteLength) return;
    let capacity = this.buffer.byteLength * 2;
    while (capacity < needed) capacity *= 2;
    const next = new ArrayBuffer(capacity);
    new Uint8Array(next).set(this.bytes.subarray(0, this.offset));
    this.buffer = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }

  u8(value: number) {
    this.ensure(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
    return this;
  }
  i16(value: number) {
    this.ensure(2);
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
    return this;
  }
  u16(value: number) {
    this.ensure(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
    return this;
  }
  i32(value: number) {
    this.ensure(4);
    this.view.setInt32(this.offset, value, true);
    this.offset += 4;
    return this;
  }
  u32(value: number) {
    this.ensure(4);
    this.view.setUint32(this.offset, value, true);
    this.offset += 4;
    return this;
  }
  f32(value: number) {
    this.ensure(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
    return this;
  }
  f64(value: number) {
    this.ensure(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
    return this;
  }
  /** Length-prefixed (u32) bytes. */
  block(data: Uint8Array) {
    this.u32(data.byteLength);
    this.raw(data);
    return this;
  }
  raw(data: Uint8Array) {
    this.ensure(data.byteLength);
    this.bytes.set(data, this.offset);
    this.offset += data.byteLength;
    return this;
  }
  /** A copy of the written bytes in a buffer of exactly that size (safe to transfer). */
  finish(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }
  reset() {
    this.offset = 0;
    return this;
  }
}

export class ByteReader {
  private view: DataView;
  offset = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining() {
    return this.bytes.byteLength - this.offset;
  }
  u8() {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }
  i16() {
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }
  u16() {
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }
  i32() {
    const value = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return value;
  }
  u32() {
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }
  f32() {
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }
  f64() {
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }
  block(): Uint8Array {
    const length = this.u32();
    return this.raw(length);
  }
  raw(length: number): Uint8Array {
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  rest(): Uint8Array {
    return this.raw(this.remaining);
  }
}

// ---------------------------------------------------------------------------------------------
// Client -> host messages

export const encodeHello = (version = PROTOCOL_VERSION) => new ByteWriter(4).u8(Op.Hello).u8(0).u16(version).finish();

export const encodeGenerate = (cx: number, cy: number, seed: number, space = 0) =>
  new ByteWriter(16).u8(Op.Generate).u8(0).u16(space).i16(cx).i16(cy).u32(seed >>> 0).finish();

export const encodeLoad = (cx: number, cy: number, bytes: Uint8Array, space = 0) =>
  new ByteWriter(bytes.byteLength + 8).u8(Op.Load).u8(0).u16(space).i16(cx).i16(cy).raw(bytes).finish();

export const encodeUnload = (cx: number, cy: number, space = 0) =>
  new ByteWriter(8).u8(Op.Unload).u8(0).u16(space).i16(cx).i16(cy).finish();

export const encodeTier = (cx: number, cy: number, tier: Tier, snapshotEvery: number, space = 0) =>
  new ByteWriter(12).u8(Op.Tier).u8(0).u16(space).i16(cx).i16(cy).u8(tier).u8(snapshotEvery).finish();

export const encodeConfig = (bytes: Uint8Array) => new ByteWriter(bytes.byteLength + 4).u8(Op.Config).raw(bytes).finish();

export const encodeInput = (gid: number, bytes: Uint8Array) =>
  new ByteWriter(bytes.byteLength + 8).u8(Op.Input).u32(gid).raw(bytes).finish();

export const encodeTrack = (gids: readonly number[]) => {
  const writer = new ByteWriter(8 + gids.length * 4).u8(Op.Track).u32(gids.length);
  for (const gid of gids) writer.u32(gid);
  return writer.finish();
};

export type RouteEntry = { cx: number; cy: number; host: number; space?: number };

export const encodeRoute = (self: number, entries: readonly RouteEntry[]) => {
  const writer = new ByteWriter(16 + entries.length * 8).u8(Op.Route).i16(self).u32(entries.length);
  for (const entry of entries) writer.u16(entry.space ?? 0).i16(entry.cx).i16(entry.cy).i16(entry.host);
  return writer.finish();
};

/**
 * The campaign clock: every host has completed at least `tick`. A host may run at most `maxLead`
 * ticks past it (0: unbounded), so a slow host holds the others back instead of them racing
 * ahead and committing trips or totals against a timeline the slow host hasn't reached.
 */
export const encodeCommit = (tick: number, maxLead: number) =>
  new ByteWriter(8).u8(Op.Commit).u8(0).u16(maxLead).u32(tick).finish();

// ---------------------------------------------------------------------------------------------
// Transfer: entity rows walking into chunk (cx, cy) of `space`. Row positions are local to chunk
// (fx, fy) of the same space, so the receiver shifts them by (fx - cx, fy - cy) chunks.
// `returned` marks rows sent back to the chunk they left because the destination could not take
// them. Walking never crosses spaces: that is a trip (Depart / Arrive).

export const encodeTransfer = (
  cx: number,
  cy: number,
  fx: number,
  fy: number,
  returned: boolean,
  count: number,
  rows: Uint8Array,
  space = 0
) =>
  new ByteWriter(rows.byteLength + 20)
    .u8(Op.Transfer)
    .u8(returned ? 1 : 0)
    .u16(space)
    .i16(cx)
    .i16(cy)
    .i16(fx)
    .i16(fy)
    .u32(count)
    .raw(rows)
    .finish();

export type TransferMessage = {
  space: number;
  cx: number;
  cy: number;
  fx: number;
  fy: number;
  returned: boolean;
  count: number;
  rows: Uint8Array;
};

// ---------------------------------------------------------------------------------------------
// Trips: a stable transaction id `txn` names one group of travellers. Depart moves their rows out
// of a chunk to the client (the campaign owns them while in transit); Arrive puts them into the
// destination chunk at chunk-local (x, y), in any space. A host applies each Arrive txn once and
// answers Arrived, also for repeats, so retries cannot create extra passengers.

export const encodeDepart = (txn: number, space: number, cx: number, cy: number, count: number, rows: Uint8Array) =>
  new ByteWriter(rows.byteLength + 20).u8(Op.Depart).u8(0).u16(space).u32(txn).i16(cx).i16(cy).u32(count).raw(rows).finish();

export const encodeArrive = (
  txn: number,
  space: number,
  cx: number,
  cy: number,
  x: number,
  y: number,
  count: number,
  rows: Uint8Array
) =>
  new ByteWriter(rows.byteLength + 28)
    .u8(Op.Arrive)
    .u8(0)
    .u16(space)
    .u32(txn)
    .i16(cx)
    .i16(cy)
    .f32(x)
    .f32(y)
    .u32(count)
    .raw(rows)
    .finish();

export const encodeArrived = (txn: number, space: number, cx: number, cy: number, count: number) =>
  new ByteWriter(16).u8(Op.Arrived).u8(0).u16(space).u32(txn).i16(cx).i16(cy).u32(count).finish();

export type DepartMessage = { txn: number; space: number; cx: number; cy: number; count: number; rows: Uint8Array };
export type ArriveMessage = DepartMessage & { x: number; y: number };

// ---------------------------------------------------------------------------------------------
// Snapshot: header (16 bytes: op u8, pad u8, space u16, cx i16, cy i16, tick u32, count u32),
// then gid u32[n], x i16[n], y i16[n], sprite u16[n], tint u8[n]. Arrays are indexed by entity
// slot, so an entity keeps its index from one snapshot to the next.

export const SNAPSHOT_HEADER = 16;
export const snapshotBytes = (count: number) => SNAPSHOT_HEADER + count * 11;
/** Largest snapshot sprite id. */
export const MAX_SPRITE = 65535;

export type Snapshot = {
  space: number;
  cx: number;
  cy: number;
  tick: number;
  count: number;
  gid: Uint32Array;
  x: Int16Array;
  y: Int16Array;
  /** Sprite id: an index into the drawing style's atlas (u16). */
  sprite: Uint16Array;
  tint: Uint8Array;
  /** The whole message, e.g. to forward or transfer it. */
  bytes: Uint8Array;
};

/** Allocates a snapshot message and returns writable views into it. */
export const createSnapshot = (cx: number, cy: number, tick: number, count: number, space = 0): Snapshot => {
  const buffer = new ArrayBuffer(snapshotBytes(count));
  const view = new DataView(buffer);
  view.setUint8(0, Op.Snapshot);
  view.setUint16(2, space, true);
  view.setInt16(4, cx, true);
  view.setInt16(6, cy, true);
  view.setUint32(8, tick, true);
  view.setUint32(12, count, true);
  return snapshotViews(new Uint8Array(buffer), space, cx, cy, tick, count);
};

const snapshotViews = (bytes: Uint8Array, space: number, cx: number, cy: number, tick: number, count: number): Snapshot => {
  const base = bytes.byteOffset;
  const buffer = bytes.buffer as ArrayBuffer;
  let offset = base + SNAPSHOT_HEADER;
  const gid = new Uint32Array(buffer, offset, count);
  offset += count * 4;
  const x = new Int16Array(buffer, offset, count);
  offset += count * 2;
  const y = new Int16Array(buffer, offset, count);
  offset += count * 2;
  const sprite = new Uint16Array(buffer, offset, count);
  offset += count * 2;
  const tint = new Uint8Array(buffer, offset, count);
  return { space, cx, cy, tick, count, gid, x, y, sprite, tint, bytes };
};

export const decodeSnapshot = (input: Uint8Array): Snapshot => {
  // Typed views need aligned offsets; socket frames may arrive at any offset.
  const bytes = input.byteOffset % 4 === 0 ? input : input.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const space = view.getUint16(2, true);
  const cx = view.getInt16(4, true);
  const cy = view.getInt16(6, true);
  const tick = view.getUint32(8, true);
  const count = view.getUint32(12, true);
  if (bytes.byteLength < snapshotBytes(count)) throw new Error("Truncated chunk snapshot");
  return snapshotViews(bytes, space, cx, cy, tick, count);
};

// ---------------------------------------------------------------------------------------------
// Host -> client

export type StatsEntry = { cx: number; cy: number; bytes: Uint8Array; space?: number };

/**
 * Per-tick heartbeat: the tick the host just completed, how long it spent on it, and stats of the
 * chunks it stepped.
 */
export const encodeStats = (tick: number, busyMs: number, entries: readonly StatsEntry[]) => {
  let size = 20;
  for (const entry of entries) size += 10 + entry.bytes.byteLength;
  const writer = new ByteWriter(size).u8(Op.Stats).u32(tick).f32(busyMs).u32(entries.length);
  for (const entry of entries) writer.u16(entry.space ?? 0).i16(entry.cx).i16(entry.cy).u16(entry.bytes.byteLength).raw(entry.bytes);
  return writer.finish();
};

export const encodeUnloaded = (cx: number, cy: number, bytes: Uint8Array, space = 0) =>
  new ByteWriter(bytes.byteLength + 8).u8(Op.Unloaded).u8(0).u16(space).i16(cx).i16(cy).raw(bytes).finish();

export type LocateEntry = { gid: number; cx: number; cy: number; x: number; y: number; tint: number; space?: number };

export const encodeLocate = (tick: number, entries: readonly LocateEntry[]) => {
  const writer = new ByteWriter(16 + entries.length * 19).u8(Op.Locate).u32(tick).u32(entries.length);
  for (const entry of entries) {
    writer.u32(entry.gid).u16(entry.space ?? 0).i16(entry.cx).i16(entry.cy).f32(entry.x).f32(entry.y).u8(entry.tint);
  }
  return writer.finish();
};

export const encodeStatic = (cx: number, cy: number, bytes: Uint8Array, space = 0) =>
  new ByteWriter(bytes.byteLength + 8).u8(Op.Static).u8(0).u16(space).i16(cx).i16(cy).raw(bytes).finish();

export const encodeLog = (level: number, text: string) => {
  const utf8 = new TextEncoder().encode(text);
  return new ByteWriter(utf8.byteLength + 4).u8(Op.Log).u8(level).raw(utf8).finish();
};

/** Overlay header: op u8, pad u8, space u16, cx i16, cy i16, tick u32; then the game's bytes. */
export const encodeOverlay = (cx: number, cy: number, tick: number, bytes: Uint8Array, space = 0) =>
  new ByteWriter(bytes.byteLength + 12).u8(Op.Overlay).u8(0).u16(space).i16(cx).i16(cy).u32(tick).raw(bytes).finish();

export type OverlayMessage = { space: number; cx: number; cy: number; tick: number; bytes: Uint8Array };

export const encodeReady = (cx: number, cy: number, population: number, space = 0) =>
  new ByteWriter(12).u8(Op.Ready).u8(0).u16(space).i16(cx).i16(cy).u32(population).finish();

// ---------------------------------------------------------------------------------------------
// Decoding

export type Message =
  | { op: Op.Hello; version: number }
  | { op: Op.Generate; space: number; cx: number; cy: number; seed: number }
  | { op: Op.Load; space: number; cx: number; cy: number; bytes: Uint8Array }
  | { op: Op.Unload; space: number; cx: number; cy: number }
  | { op: Op.Tier; space: number; cx: number; cy: number; tier: Tier; snapshotEvery: number }
  | { op: Op.Config; bytes: Uint8Array }
  | { op: Op.Input; gid: number; bytes: Uint8Array }
  | { op: Op.Track; gids: number[] }
  | { op: Op.Route; self: number; entries: RouteEntry[] }
  | { op: Op.Commit; tick: number; maxLead: number }
  | ({ op: Op.Transfer } & TransferMessage)
  | ({ op: Op.Depart } & DepartMessage)
  | ({ op: Op.Arrive } & ArriveMessage)
  | { op: Op.Arrived; txn: number; space: number; cx: number; cy: number; count: number }
  | { op: Op.Snapshot; snapshot: Snapshot }
  | { op: Op.Stats; tick: number; busyMs: number; entries: StatsEntry[] }
  | { op: Op.Unloaded; space: number; cx: number; cy: number; bytes: Uint8Array }
  | { op: Op.Locate; tick: number; entries: LocateEntry[] }
  | { op: Op.Static; space: number; cx: number; cy: number; bytes: Uint8Array }
  | { op: Op.Log; level: number; text: string }
  | { op: Op.Ready; space: number; cx: number; cy: number; population: number }
  | ({ op: Op.Overlay } & OverlayMessage);

/** Reads the (pad, space, cx, cy) prefix shared by chunk-addressed messages. */
const address = (reader: ByteReader) => {
  reader.u8();
  return { space: reader.u16(), cx: reader.i16(), cy: reader.i16() };
};

export const decodeMessage = (bytes: Uint8Array): Message => {
  const op = bytes[0] as Op;
  if (op === Op.Snapshot) return { op, snapshot: decodeSnapshot(bytes) };
  const reader = new ByteReader(bytes);
  reader.u8();
  switch (op) {
    case Op.Hello:
      reader.u8();
      return { op, version: reader.u16() };
    case Op.Generate:
      return { op, ...address(reader), seed: reader.u32() };
    case Op.Load:
      return { op, ...address(reader), bytes: reader.rest() };
    case Op.Unload:
      return { op, ...address(reader) };
    case Op.Tier:
      return { op, ...address(reader), tier: reader.u8() as Tier, snapshotEvery: reader.u8() };
    case Op.Config:
      return { op, bytes: reader.rest() };
    case Op.Input:
      return { op, gid: reader.u32(), bytes: reader.rest() };
    case Op.Track: {
      const count = reader.u32();
      const gids: number[] = [];
      for (let i = 0; i < count; i++) gids.push(reader.u32());
      return { op, gids };
    }
    case Op.Route: {
      const self = reader.i16();
      const count = reader.u32();
      const entries: RouteEntry[] = [];
      for (let i = 0; i < count; i++) entries.push({ space: reader.u16(), cx: reader.i16(), cy: reader.i16(), host: reader.i16() });
      return { op, self, entries };
    }
    case Op.Commit: {
      reader.u8();
      const maxLead = reader.u16();
      return { op, maxLead, tick: reader.u32() };
    }
    case Op.Transfer: {
      const returned = reader.u8() === 1;
      return {
        op,
        returned,
        space: reader.u16(),
        cx: reader.i16(),
        cy: reader.i16(),
        fx: reader.i16(),
        fy: reader.i16(),
        count: reader.u32(),
        rows: reader.rest(),
      };
    }
    case Op.Depart: {
      reader.u8();
      const space = reader.u16();
      const txn = reader.u32();
      return { op, space, txn, cx: reader.i16(), cy: reader.i16(), count: reader.u32(), rows: reader.rest() };
    }
    case Op.Arrive: {
      reader.u8();
      const space = reader.u16();
      const txn = reader.u32();
      const cx = reader.i16();
      const cy = reader.i16();
      return { op, space, txn, cx, cy, x: reader.f32(), y: reader.f32(), count: reader.u32(), rows: reader.rest() };
    }
    case Op.Arrived: {
      reader.u8();
      const space = reader.u16();
      const txn = reader.u32();
      return { op, space, txn, cx: reader.i16(), cy: reader.i16(), count: reader.u32() };
    }
    case Op.Stats: {
      const tick = reader.u32();
      const busyMs = reader.f32();
      const count = reader.u32();
      const entries: StatsEntry[] = [];
      for (let i = 0; i < count; i++) {
        const space = reader.u16();
        const cx = reader.i16();
        const cy = reader.i16();
        entries.push({ space, cx, cy, bytes: reader.raw(reader.u16()) });
      }
      return { op, tick, busyMs, entries };
    }
    case Op.Unloaded:
      return { op, ...address(reader), bytes: reader.rest() };
    case Op.Locate: {
      const tick = reader.u32();
      const count = reader.u32();
      const entries: LocateEntry[] = [];
      for (let i = 0; i < count; i++) {
        entries.push({
          gid: reader.u32(),
          space: reader.u16(),
          cx: reader.i16(),
          cy: reader.i16(),
          x: reader.f32(),
          y: reader.f32(),
          tint: reader.u8(),
        });
      }
      return { op, tick, entries };
    }
    case Op.Static:
      return { op, ...address(reader), bytes: reader.rest() };
    case Op.Log:
      return { op, level: reader.u8(), text: new TextDecoder().decode(reader.rest()) };
    case Op.Ready:
      return { op, ...address(reader), population: reader.u32() };
    case Op.Overlay:
      return { op, ...address(reader), tick: reader.u32(), bytes: reader.rest() };
    default:
      throw new Error(`Unknown chunk protocol op ${op}`);
  }
};
