/**
 * Transports carry protocol bytes between a chunk client and a chunk host. They know nothing
 * about the protocol: a worker port, a WebSocket and a peer DataChannel all look the same.
 */

export interface ChunkTransport {
  /**
   * Sends one message. With `transfer`, a local transport may move the buffer instead of copying
   * it; the caller must not touch `bytes` afterwards.
   */
  send(bytes: Uint8Array, transfer?: boolean): void;
  onMessage(handler: (bytes: Uint8Array) => void): void;
  close?(): void;
}

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
  addEventListener?(type: string, listener: (event: any) => void): void;
  on?(type: string, listener: (...args: any[]) => void): void;
  close?(): void;
};

/**
 * A browser WebSocket or a Node `ws` socket. Messages sent before the socket opens are queued.
 */
export const socketTransport = (socket: SocketLike): ChunkTransport => {
  let handler: ((bytes: Uint8Array) => void) | null = null;
  const pending: Uint8Array[] = [];
  const outbox: Uint8Array[] = [];
  const isOpen = () => socket.readyState === undefined || socket.readyState === 1;
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
    socket.on("open", () => flush());
  } else {
    socket.addEventListener?.("message", (event: MessageEvent) => {
      const bytes = toBytes(event.data);
      if (bytes) deliver(bytes);
    });
    socket.addEventListener?.("open", () => flush());
  }
  const flush = () => {
    while (outbox.length && isOpen()) socket.send(outbox.shift()!);
  };
  return {
    send(bytes) {
      if (!isOpen()) {
        outbox.push(bytes.slice());
        return;
      }
      flush();
      socket.send(bytes);
    },
    onMessage(next) {
      handler = next;
      while (pending.length) next(pending.shift()!);
    },
    close() {
      socket.close?.();
    },
  };
};

type ChannelLike = {
  binaryType?: string;
  readyState?: string;
  send(data: ArrayBuffer): void;
  addEventListener(type: string, listener: (event: any) => void): void;
  close?(): void;
};

/** A WebRTC DataChannel, for one player's machine hosting chunks for others. */
export const dataChannelTransport = (channel: ChannelLike): ChunkTransport => {
  let handler: ((bytes: Uint8Array) => void) | null = null;
  const pending: Uint8Array[] = [];
  const outbox: Uint8Array[] = [];
  channel.binaryType = "arraybuffer";
  const flush = () => {
    while (outbox.length && channel.readyState === "open") {
      const bytes = outbox.shift()!;
      channel.send(bytes.slice().buffer);
    }
  };
  channel.addEventListener("open", flush);
  channel.addEventListener("message", (event: MessageEvent) => {
    if (!(event.data instanceof ArrayBuffer)) return;
    const bytes = new Uint8Array(event.data);
    if (handler) handler(bytes);
    else pending.push(bytes);
  });
  return {
    send(bytes) {
      if (channel.readyState !== "open") {
        outbox.push(bytes.slice());
        return;
      }
      flush();
      channel.send(bytes.slice().buffer);
    },
    onMessage(next) {
      handler = next;
      while (pending.length) next(pending.shift()!);
    },
    close() {
      channel.close?.();
    },
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
