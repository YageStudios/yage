import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spaceChunkKey } from "yage/streaming/coord";
import { createSnapshot, encodeDone, encodeHello, remoteSnapshotEvery, replaceableKey } from "yage/streaming/protocol";
import { socketTransport, type BackpressureOptions } from "yage/streaming/transport";

/** A ws-like socket whose wire drains `rate` bytes a millisecond (Infinity: as fast as it is sent). */
const fakeSocket = (rate = Infinity, readyState = 1) => {
  const listeners = new Map<string, ((...args: any[]) => void)[]>();
  const inFlight: { bytes: Uint8Array; left: number }[] = [];
  const wire: Uint8Array[] = [];
  const socket = {
    readyState,
    bufferedAmount: 0,
    closed: false,
    send(data: ArrayBufferView | ArrayBuffer) {
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
      if (rate === Infinity) wire.push(bytes);
      else {
        inFlight.push({ bytes, left: bytes.byteLength });
        socket.bufferedAmount += bytes.byteLength;
      }
    },
    on(type: string, listener: (...args: any[]) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    close() {
      socket.closed = true;
      socket.readyState = 3;
      for (const l of listeners.get("close") ?? []) l();
    },
    open() {
      socket.readyState = 1;
      for (const l of listeners.get("open") ?? []) l();
    },
    /** One millisecond of wire time; returns what finished arriving. */
    drain(ms = 1) {
      let budget = rate * ms;
      const arrived: Uint8Array[] = [];
      while (inFlight.length && budget > 0) {
        const head = inFlight[0];
        const take = Math.min(budget, head.left);
        head.left -= take;
        budget -= take;
        socket.bufferedAmount -= take;
        if (head.left <= 0) arrived.push(inFlight.shift()!.bytes);
      }
      wire.push(...arrived);
      return arrived;
    },
    wire,
  };
  return socket;
};

const snapshot = (cx: number, tick: number, count = 4) => createSnapshot(cx, 0, tick, count).bytes;
const describeMessage = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return replaceableKey(bytes) === null ? `done ${view.getUint32(4, true)}` : `snap ${view.getInt32(4, true)}@${view.getUint32(12, true)}`;
};

describe("remote presentation rate", () => {
  it("sends a fixed number of snapshots a second of wall time, whatever the play speed", () => {
    expect(remoteSnapshotEvery(60)).toBe(4);
    expect(remoteSnapshotEvery(60, 2)).toBe(8);
    expect(remoteSnapshotEvery(60, 4)).toBe(16);
    // Paused (rate 0) keeps the 1x rate: the next step it sends is on time.
    expect(remoteSnapshotEvery(60, 0)).toBe(4);
    expect(remoteSnapshotEvery(60, 1, 60)).toBe(1);
    expect(remoteSnapshotEvery(60, 1, 0.01)).toBe(255);
  });

  it("keys only snapshots, by their chunk", () => {
    expect(replaceableKey(createSnapshot(3, -2, 9, 1, 2).bytes)).toBe(spaceChunkKey(2, 3, -2));
    expect(replaceableKey(encodeDone(9))).toBeNull();
    expect(replaceableKey(encodeHello())).toBeNull();
    expect(replaceableKey(new Uint8Array(0))).toBeNull();
  });
});

describe("socket backpressure", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends straight through an uncongested socket", () => {
    const socket = fakeSocket();
    const transport = socketTransport(socket);
    const sent = [snapshot(0, 1), encodeDone(1), snapshot(0, 2), encodeDone(2)];
    for (const bytes of sent) transport.send(bytes);
    expect(socket.wire).toEqual(sent);
    expect(transport.stats!()).toMatchObject({ sent: 4, queued: 0, dropped: 0 });
  });

  it("queues what is sent before the socket opens, in order", () => {
    const socket = fakeSocket(Infinity, 0);
    const transport = socketTransport(socket);
    const sent = [encodeHello(), snapshot(0, 1), encodeDone(1), snapshot(0, 2), encodeDone(2)];
    for (const bytes of sent) transport.send(bytes);
    expect(socket.wire).toEqual([]);
    socket.open();
    // The superseded snapshot of chunk 0 is never sent late.
    expect(socket.wire).toEqual([sent[0], sent[2], sent[3], sent[4]]);
    expect(transport.stats!().dropped).toBe(1);
  });

  it("holds snapshots on a congested socket, keeping only the newest of each chunk, and every other message in order", () => {
    const socket = fakeSocket();
    const transport = socketTransport(socket, { maxBufferedBytes: 64 });
    // The socket holds more than its cap: snapshots wait, and so does everything sent after one.
    socket.bufferedAmount = 1000;
    transport.send(encodeDone(1));
    transport.send(snapshot(0, 2, 10));
    transport.send(snapshot(1, 2, 10));
    transport.send(encodeDone(2));
    transport.send(snapshot(0, 3, 10));
    transport.send(encodeDone(3));
    expect(transport.stats!()).toMatchObject({ sent: 1, queued: 4, dropped: 1 });
    expect(vi.getTimerCount()).toBe(1);
    // Still congested on the retry: nothing moves.
    vi.advanceTimersByTime(10);
    expect(socket.wire.length).toBe(1);
    socket.bufferedAmount = 0;
    vi.advanceTimersByTime(10);
    expect(socket.wire.map(describeMessage)).toEqual(["done 1", "snap 1@2", "done 2", "snap 0@3", "done 3"]);
    expect(transport.stats!()).toMatchObject({ sent: 5, queued: 0, queuedBytes: 0, dropped: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sends one snapshot bigger than the cap once the socket is clear, and reliable messages whatever it holds", () => {
    const socket = fakeSocket(1);
    const transport = socketTransport(socket, { maxBufferedBytes: 64 });
    transport.send(snapshot(0, 1, 10));
    transport.send(snapshot(1, 1, 10));
    transport.send(encodeDone(1));
    // The first went (the socket was empty); the second waits behind it, and the Done behind that.
    expect(transport.stats!()).toMatchObject({ sent: 1, queued: 2 });
    vi.advanceTimersByTime(10);
    expect(transport.stats!()).toMatchObject({ sent: 1, queued: 2 });
    socket.drain(1000);
    vi.advanceTimersByTime(10);
    expect(transport.stats!()).toMatchObject({ sent: 3, queued: 0 });
    socket.drain(1000);
    expect(socket.wire.map(describeMessage)).toEqual(["snap 0@1", "snap 1@1", "done 1"]);
  });

  it("closes a link whose reliable queue passes its cap", () => {
    const socket = fakeSocket(0);
    const overflow = vi.fn();
    const transport = socketTransport(socket, { maxBufferedBytes: 64, maxQueuedBytes: 100 });
    socket.bufferedAmount = 1000;
    transport.send(snapshot(0, 1, 10));
    for (let tick = 0; tick < 12; tick++) transport.send(encodeDone(tick));
    expect(socket.closed).toBe(true);
    // Closed, it sends nothing more and schedules nothing.
    transport.send(encodeDone(99));
    expect(vi.getTimerCount()).toBe(0);
    const custom = socketTransport(fakeSocket(0), { maxBufferedBytes: 0, maxQueuedBytes: 100, onOverflow: overflow });
    custom.send(snapshot(0, 1, 10));
    custom.send(snapshot(1, 1, 10));
    expect(overflow).toHaveBeenCalledTimes(1);
  });

  /**
   * A link that takes 40 KB/s while the host offers 15 snapshots/s of 8 chunks x 60 pawns (about
   * 80 KB/s), plus a Done each 60 Hz tick: unbounded, the socket's buffer and the snapshots' age grow
   * for as long as it runs; held back, the buffer stays under its cap, snapshots arrive fresh, and
   * every Done arrives in order.
   */
  const congested = (options: BackpressureOptions) => {
    const socket = fakeSocket(40);
    const transport = socketTransport(socket, options);
    const every = remoteSnapshotEvery(60);
    const sentAt = new Map<string, number>();
    let peakBuffered = 0;
    const ages: number[] = [];
    const done: number[] = [];
    for (let ms = 0; ms < 10_000; ms++) {
      if (ms % 16 === 0) {
        const tick = ms / 16;
        if (tick % every === 0)
          for (let cx = 0; cx < 8; cx++) {
            sentAt.set(`${cx}@${tick}`, ms);
            transport.send(createSnapshot(cx, 0, tick, 60).bytes);
          }
        transport.send(encodeDone(tick));
      }
      for (const bytes of socket.drain()) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (replaceableKey(bytes) === null) done.push(view.getUint32(4, true));
        else ages.push(ms - sentAt.get(`${view.getInt32(4, true)}@${view.getUint32(12, true)}`)!);
      }
      peakBuffered = Math.max(peakBuffered, socket.bufferedAmount);
      vi.advanceTimersByTime(1);
    }
    const late = ages.slice(-40).sort((a, b) => a - b);
    return { stats: transport.stats!(), peakBuffered, ages, lateMedianAge: late[late.length >> 1], done };
  };

  it("keeps snapshots fresh and the socket's buffer bounded on a slow link", () => {
    const unbounded = congested({ maxBufferedBytes: Infinity });
    const held = congested({ maxBufferedBytes: 16 * 1024 });
    // Every Done of the 625 ticks arrives, in order, both ways.
    const ticks = Array.from({ length: 625 }, (_, i) => i);
    expect(held.done).toEqual(ticks.slice(0, held.done.length));
    expect(unbounded.done).toEqual(ticks.slice(0, unbounded.done.length));
    // And the Dones keep up held back (behind at most a few held snapshots), but fall seconds behind the backlog unbounded.
    expect(held.done.length).toBeGreaterThanOrEqual(590);
    expect(unbounded.done.length).toBeLessThan(400);
    // Unbounded, the socket backs up by the excess (about 40 KB/s for 10 s) and late snapshots are seconds old.
    expect(unbounded.peakBuffered).toBeGreaterThan(300_000);
    expect(unbounded.lateMedianAge).toBeGreaterThan(3000);
    // Held, the buffer stays near the cap, old snapshots are dropped, and what arrives is fresh.
    expect(held.peakBuffered).toBeLessThan(16 * 1024 + 700);
    expect(held.stats.dropped).toBeGreaterThan(0);
    expect(held.lateMedianAge).toBeLessThan(700);
    expect(held.stats.peakQueuedBytes).toBeLessThan(8 * 700 + 4096);
  });
});
