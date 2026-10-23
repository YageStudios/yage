/**
 * Serves chunk hosts over WebSockets (Node). The WebSocket server is injected so the engine needs
 * no `ws` dependency: pass `new WebSocketServer({ port })` from `ws`, or anything that emits
 * "connection" with a ws-like socket.
 *
 * Every connection attaches to the same host, so clients share one world: each subscribes to its
 * own hot chunks, tracks its own entities and steers its own host entity.
 */
import { ChunkHost, type ChunkModule } from "./host";
import { socketTransport } from "./transport";

type ServerSocket = Parameters<typeof socketTransport>[0] & {
  on(type: "close", listener: () => void): void;
};

export type WebSocketServerLike = {
  on(type: "connection", listener: (socket: ServerSocket) => void): void;
  close?(): void;
};

export type ServeChunksOptions = {
  /** Use an existing host (e.g. one tests drive by hand) instead of a self-ticking one. */
  host?: ChunkHost;
  onConnect?: (count: number) => void;
  onDisconnect?: (count: number) => void;
};

export const serveChunks = (module: ChunkModule, server: WebSocketServerLike, options: ServeChunksOptions = {}) => {
  const host = options.host ?? new ChunkHost(module, { autoTick: true });
  let clients = 0;
  server.on("connection", (socket) => {
    const detach = host.attach(socketTransport(socket));
    clients++;
    options.onConnect?.(clients);
    socket.on("close", () => {
      detach();
      clients--;
      options.onDisconnect?.(clients);
    });
  });
  return {
    host,
    get clients() {
      return clients;
    },
    close() {
      host.stop();
      server.close?.();
    },
  };
};
