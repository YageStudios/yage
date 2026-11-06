/**
 * Transports carry protocol bytes between a chunk client and a chunk host. They read nothing of
 * the protocol but which messages a newer one replaces (`replaceableKey`): a worker port, a
 * WebSocket and a peer DataChannel all look the same.
 *
 * A network transport (socket, DataChannel) holds back what the link can't take yet: past
 * `maxBufferedBytes` in the socket's own buffer it queues instead of sending, keeping at most the
 * newest unsent snapshot of each chunk (an older one is dropped from the queue, never sent late)
 * and every other message in the order it was sent. So a slow link gets fewer, fresher snapshots
 * while commands, stats, hand-offs and overlays arrive whole and in order; and a queue of those
 * past `maxQueuedBytes` (a link that can't keep up even without snapshots) closes the link.
 */
import { replaceableKey } from "./protocol";

export interface ChunkTransport {
  /**
   * Sends one message. With `transfer`, a local transport may move the buffer instead of copying
   * it; the caller must not touch `bytes` afterwards.
   */
  send(bytes: Uint8Array, transfer?: boolean): void;
  onMessage(handler: (bytes: Uint8Array) => void): void;
  close?(): void;
  /** A network transport's sending so far (`backpressure`). */
  stats?(): TransportStats;
}

export type TransportStats = {
  /** Bytes handed to the link, and how many messages. */
  sentBytes: number;
  sent: number;
  /** Held in this transport's queue now (not yet handed to the link). */
  queuedBytes: number;
  queued: number;
  /** The most it has held at once. */
  peakQueuedBytes: number;
  /** Snapshots replaced in the queue by a newer one of their chunk before they were sent. */
  dropped: number;
  /** The link's own buffer when last asked. */
  bufferedBytes: number;
};

export type BackpressureOptions = {
  /** Replaceable messages wait while the link's buffer holds more than this. Default 256 KiB. */
  maxBufferedBytes?: number;
  /** A queue of reliable messages past this closes the link (`onOverflow`). Default 16 MiB. */
  maxQueuedBytes?: number;
  /** What a newer message replaces (default `replaceableKey`: a chunk's snapshot); null: reliable. */
  replaceable?: (bytes: Uint8Array) => number | null;
  /** How often (ms) a held queue tries the link again. Default 10. */
  retryMs?: number;
  /** The queue overflowed; default closes the link. */
  onOverflow?: () => void;
};

type Queued = { bytes: Uint8Array; key: number | null; dropped: boolean };

/**
 * The sending side of a network transport: what goes to the link now and what waits (see the
 * module's notes). `write` hands bytes to the link, `open` says whether it takes any, `buffered`
 * how much it holds unsent.
 */
export const backpressure = (link: { write(bytes: Uint8Array): void; open(): boolean; buffered(): number; close(): void }, options: BackpressureOptions = {}) => {
  const maxBuffered = options.maxBufferedBytes ?? 256 * 1024;
  const maxQueued = options.maxQueuedBytes ?? 16 * 1024 * 1024;
  const replaceable = options.replaceable ?? replaceableKey;
  const retryMs = options.retryMs ?? 10;
  // Oldest first; a replaced entry stays in place, marked, until the head reaches it.
  const queue: Queued[] = [];
  let head = 0;
  const latest = new Map<number, Queued>();
  const stats: TransportStats = { sentBytes: 0, sent: 0, queuedBytes: 0, queued: 0, peakQueuedBytes: 0, dropped: 0, bufferedBytes: 0 };
  let retry: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const write = (bytes: Uint8Array) => {
    link.write(bytes);
    stats.sentBytes += bytes.byteLength;
    stats.sent++;
  };
  /** Whether a replaceable message of `size` bytes may go to the link now. */
  const room = (size: number) => {
    stats.bufferedBytes = link.buffered();
    // One at a time over the cap: a snapshot bigger than the cap still goes once the link is clear.
    return stats.bufferedBytes === 0 || stats.bufferedBytes + size <= maxBuffered;
  };
  const schedule = () => {
    if (retry || closed) return;
    retry = setTimeout(() => {
      retry = null;
      flush();
    }, retryMs);
  };
  const flush = () => {
    while (head < queue.length && link.open()) {
      const next = queue[head];
      if (!next.dropped) {
        if (next.key !== null && !room(next.bytes.byteLength)) break;
        if (next.key !== null) latest.delete(next.key);
        write(next.bytes);
        stats.queuedBytes -= next.bytes.byteLength;
        stats.queued--;
      }
      head++;
    }
    if (head === queue.length) {
      queue.length = 0;
      head = 0;
    } else if (head > 1024 && head * 2 > queue.length) {
      queue.splice(0, head);
      head = 0;
    }
    if (head < queue.length && link.open()) schedule();
  };
  const enqueue = (bytes: Uint8Array, key: number | null) => {
    const entry: Queued = { bytes: bytes.slice(), key, dropped: false };
    if (key !== null) {
      const older = latest.get(key);
      if (older) {
        older.dropped = true;
        stats.queuedBytes -= older.bytes.byteLength;
        stats.queued--;
        stats.dropped++;
      }
      latest.set(key, entry);
    }
    queue.push(entry);
    stats.queuedBytes += entry.bytes.byteLength;
    stats.queued++;
    stats.peakQueuedBytes = Math.max(stats.peakQueuedBytes, stats.queuedBytes);
    if (stats.queuedBytes > maxQueued) {
      if (options.onOverflow) options.onOverflow();
      else link.close();
    }
  };
  return {
    send(bytes: Uint8Array) {
      if (closed) return;
      const key = replaceable(bytes);
      // Anything queued goes first, so nothing overtakes what was sent before it.
      if (head < queue.length) flush();
      if (head === queue.length && link.open() && (key === null || room(bytes.byteLength))) write(bytes);
      else {
        enqueue(bytes, key);
        if (link.open()) schedule();
      }
    },
    flush,
    stats: () => ({ ...stats, bufferedBytes: link.buffered() }),
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      retry = null;
    },
  };
};

type PortLike = {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener?(type: "message", listener: (event: MessageEvent) => void): void;
  onmessage?: ((event: MessageEvent) => void) | null;
  start?(): void;
  close?(): void;
  terminate?(): void;
};

const ownsBuffer = (bytes: Uint8Array) => bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength;

/**
 * A Worker, MessagePort or worker-global `self`. Messages are ArrayBuffers; other message shapes
 * (such as setup objects carrying ports) are passed to `onControl`.
 */
export const portTransport = (port: PortLike, onControl?: (data: unknown, event: MessageEvent) => void): ChunkTransport => {
  let handler: ((bytes: Uint8Array) => void) | null = null;
  const pending: Uint8Array[] = [];
  const listener = (event: MessageEvent) => {
    const data = event.data;
    if (data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(data);
      if (handler) handler(bytes);
      else pending.push(bytes);
    } else {
      onControl?.(data, event);
    }
  };
  if (port.addEventListener) port.addEventListener("message", listener);
  else port.onmessage = listener;
  port.start?.();
  return {
    send(bytes, transfer = false) {
      if (transfer && ownsBuffer(bytes)) {
        port.postMessage(bytes.buffer, [bytes.buffer as ArrayBuffer]);
      } else {
        const copy = bytes.slice();
        port.postMessage(copy.buffer, [copy.buffer]);
      }
    },
    onMessage(next) {
      handler = next;
      while (pending.length) next(pending.shift()!);
    },
    close() {
      port.close?.();
      port.terminate?.();
    },
  };
};

type SocketLike = {
  binaryType?: string;
  send(data: ArrayBufferView | ArrayBuffer): void;
  readyState?: number;
  /** Bytes sent and not yet on the wire (browser WebSocket and ws both keep it). */
  bufferedAmount?: number;
  addEventListener?(type: string, listener: (event: any) => void): void;
  on?(type: string, listener: (...args: any[]) => void): void;
  close?(): void;
};

/**
 * A browser WebSocket or a Node `ws` socket. Messages sent before the socket opens are queued, and
 * a congested socket holds back snapshots (`backpressure`).
 */
export const socketTransport = (socket: SocketLike, options: BackpressureOptions = {}): ChunkTransport => {
  let handler: ((bytes: Uint8Array) => void) | null = null;
  const pending: Uint8Array[] = [];
  const isOpen = () => socket.readyState === undefined || socket.readyState === 1;
  const out = backpressure({ write: (bytes) => socket.send(bytes), open: isOpen, buffered: () => socket.bufferedAmount ?? 0, close: () => socket.close?.() }, options);
  const deliver = (bytes: Uint8Array) => {
    if (handler) handler(bytes);
    else pending.push(bytes);
  };
  const toBytes = (data: any): Uint8Array | null => {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (Array.isArray(data)) {
      // ws may deliver fragmented frames as a list of Buffers.
      const total = data.reduce((sum: number, part: Uint8Array) => sum + part.byteLength, 0);
      const joined = new Uint8Array(total);
      let offset = 0;
      for (const part of data) {
        joined.set(part, offset);
        offset += part.byteLength;
      }
      return joined;
    }
    return null;
  };
  socket.binaryType = socket.on ? "nodebuffer" : "arraybuffer";
  if (socket.on) {
    socket.on("message", (data: any) => {
      const bytes = toBytes(data);
      if (bytes) deliver(bytes);
    });
    socket.on("open", () => out.flush());
    socket.on("close", () => out.close());
  } else {
    socket.addEventListener?.("message", (event: MessageEvent) => {
      const bytes = toBytes(event.data);
      if (bytes) deliver(bytes);
    });
    socket.addEventListener?.("open", () => out.flush());
    socket.addEventListener?.("close", () => out.close());
  }
  return {
    send(bytes) {
      out.send(bytes);
    },
    onMessage(next) {
      handler = next;
      while (pending.length) next(pending.shift()!);
    },
    close() {
      out.close();
      socket.close?.();
    },
    stats: out.stats,
  };
};

type ChannelLike = {
  binaryType?: string;
  readyState?: string;
  bufferedAmount?: number;
  send(data: ArrayBuffer): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  close?(): void;
};

/** A WebRTC DataChannel, for one player's machine hosting chunks for others; congested, it holds back snapshots (`backpressure`). */
export const dataChannelTransport = (channel: ChannelLike, options: BackpressureOptions = {}): ChunkTransport => {
  let handler: ((bytes: Uint8Array) => void) | null = null;
  const pending: Uint8Array[] = [];
  channel.binaryType = "arraybuffer";
  const out = backpressure(
    { write: (bytes) => channel.send(bytes.slice().buffer), open: () => channel.readyState === "open", buffered: () => channel.bufferedAmount ?? 0, close: () => channel.close?.() },
    options,
  );
  channel.addEventListener("open", () => out.flush());
  channel.addEventListener("close", () => out.close());
  channel.addEventListener("message", (event: MessageEvent) => {
    if (!(event.data instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(event.data);
    if (handler) handler(bytes);
    else pending.push(bytes);
  });
  return {
    send(bytes) {
      out.send(bytes);
    },
    onMessage(next) {
      handler = next;
      while (pending.length) next(pending.shift()!);
    },
    close() {
      out.close();
      channel.close?.();
    },
    stats: out.stats,
  };
};

/**
 * Two connected in-process transports, for tests and for running a host on the main thread.
 * Delivery is synchronous unless `async` is set, and every message is copied, as on a wire.
 */
export const memoryTransportPair = ({ async = false } = {}): [ChunkTransport, ChunkTransport] => {
  const make = () => {
    let handler: ((bytes: Uint8Array) => void) | null = null;
    const pending: Uint8Array[] = [];
    return {
      deliver(bytes: Uint8Array) {
        if (handler) handler(bytes);
        else pending.push(bytes);
      },
      transport: null as unknown as ChunkTransport,
      set(next: (bytes: Uint8Array) => void) {
        handler = next;
        while (pending.length) next(pending.shift()!);
      },
    };
  };
  const a = make();
  const b = make();
  const link = (from: typeof a, to: typeof b): ChunkTransport => ({
    send(bytes) {
      const copy = bytes.slice();
      if (async) queueMicrotask(() => to.deliver(copy));
      else to.deliver(copy);
    },
    onMessage(next) {
      from.set(next);
    },
  });
  return [link(a, b), link(b, a)];
};
