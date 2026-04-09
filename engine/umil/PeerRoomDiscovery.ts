import Peer, { type DataConnection } from "peerjs";
import { customAlphabet } from "nanoid";
import type { UMIL_RoomData } from "./types";

const nanoid = customAlphabet("234579ACDEFGHJKMNPQRTWXYZ", 10);

type DiscoveryMessage = { type: "announce"; rooms: UMIL_RoomData[] } | { type: "state"; rooms: UMIL_RoomData[] };

type PeerRoomDiscoveryOptions = {
  prefix: string;
  host?: string;
  lobbyId: string;
  onRoomsChanged?: (rooms: UMIL_RoomData[]) => void;
  connectionTimeoutMs?: number;
};

export class PeerRoomDiscovery {
  private readonly prefix: string;
  private readonly host?: string;
  private readonly lobbyId: string;
  private readonly onRoomsChanged?: (rooms: UMIL_RoomData[]) => void;
  private readonly connectionTimeoutMs: number;

  private peer: Peer | null = null;
  private coordinatorConnection: DataConnection | null = null;
  private readonly connections = new Map<string, DataConnection>();
  private readonly localRooms = new Map<string, UMIL_RoomData>();
  private readonly roomClaims = new Map<string, Map<string, UMIL_RoomData>>();
  private rooms: UMIL_RoomData[] = [];
  private started = false;
  private stopped = false;
  private isCoordinator = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor({ prefix, host, lobbyId, onRoomsChanged, connectionTimeoutMs = 2000 }: PeerRoomDiscoveryOptions) {
    this.prefix = prefix;
    this.host = host;
    this.lobbyId = this.normalizeId(lobbyId);
    this.onRoomsChanged = onRoomsChanged;
    this.connectionTimeoutMs = connectionTimeoutMs;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    this.started = true;
    this.stopped = false;
    await this.connectOrClaim();
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    this.isCoordinator = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connections.forEach((conn) => conn.close());
    this.connections.clear();
    this.coordinatorConnection?.close();
    this.coordinatorConnection = null;
    this.peer?.destroy();
    this.peer = null;
    this.roomClaims.clear();
  }

  publishRoom(room: UMIL_RoomData): void {
    this.localRooms.set(room.roomId, room);
    this.syncLocalRooms();
  }

  unpublishRoom(roomId: string): void {
    this.localRooms.delete(roomId);
    this.syncLocalRooms();
  }

  getRooms(): UMIL_RoomData[] {
    return [...this.rooms];
  }

  private normalizeId(value: string): string {
    return value.startsWith(this.prefix) ? value : `${this.prefix}${value}`;
  }

  private createPeer(id: string): Promise<Peer> {
    return new Promise((resolve, reject) => {
      const options = this.buildPeerOptions();
      const peer = options ? new Peer(id, options) : new Peer(id);
      let settled = false;

      peer.once("open", () => {
        settled = true;
        this.attachPeerConnectionHandler(peer);
        resolve(peer);
      });

      peer.once("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        peer.destroy();
        reject(error);
      });
    });
  }

  private buildPeerOptions():
    | {
        host: string;
        port: number;
        path: string;
        secure: boolean;
      }
    | undefined {
    if (!this.host) {
      return undefined;
    }

    const [hostPart, rest = "443"] = this.host.split(":");
    const [portPart, ...pathParts] = rest.split("/");
    const path = pathParts.length ? `/${pathParts.join("/")}` : "/";

    return {
      host: hostPart,
      port: parseInt(portPart || "443"),
      path,
      secure: true,
    };
  }

  private attachPeerConnectionHandler(peer: Peer): void {
    peer.on("connection", (conn) => {
      if (!this.isCoordinator) {
        conn.close();
        return;
      }
      this.attachConnection(conn, "incoming");
    });
  }

  private async connectOrClaim(): Promise<void> {
    if (this.stopped) {
      return;
    }

    await this.destroyPeer();
    this.isCoordinator = false;
    this.peer = await this.createPeer(this.normalizeId(nanoid()));

    try {
      await this.connectToCoordinator();
    } catch {
      await this.becomeCoordinator();
    }
  }

  private async connectToCoordinator(): Promise<void> {
    if (!this.peer) {
      throw new Error("Peer not ready");
    }

    const conn = this.peer.connect(this.lobbyId);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        conn.close();
        reject(new Error("Coordinator connection timed out"));
      }, this.connectionTimeoutMs);

      conn.once("open", () => {
        clearTimeout(timeout);
        resolve();
      });

      conn.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    this.coordinatorConnection = conn;
    this.attachConnection(conn, "coordinator");
    this.sendAnnouncement();
  }

  private async becomeCoordinator(): Promise<void> {
    if (this.stopped) {
      return;
    }

    await this.destroyPeer();

    try {
      this.peer = await this.createPeer(this.lobbyId);
      this.isCoordinator = true;
      this.roomClaims.set(this.lobbyId, new Map(this.localRooms));
      this.rebuildRooms();
    } catch {
      if (this.stopped) {
        return;
      }
      this.scheduleReconnect();
    }
  }

  private attachConnection(conn: DataConnection, role: "coordinator" | "incoming"): void {
    conn.on("data", (payload) => this.handleMessage(conn, payload as DiscoveryMessage));
    conn.on("close", () => this.handleConnectionClose(conn, role));
    conn.on("error", () => this.handleConnectionClose(conn, role));

    if (role === "incoming") {
      conn.once("open", () => {
        this.connections.set(conn.peer, conn);
        this.sendState(conn);
      });
    }
  }

  private handleMessage(conn: DataConnection, message: DiscoveryMessage): void {
    if (message.type === "state") {
      this.rooms = [...message.rooms];
      this.onRoomsChanged?.(this.getRooms());
      return;
    }

    if (message.type === "announce" && this.isCoordinator) {
      this.roomClaims.set(conn.peer, new Map(message.rooms.map((room) => [room.roomId, room])));
      this.rebuildRooms();
    }
  }

  private handleConnectionClose(conn: DataConnection, role: "coordinator" | "incoming"): void {
    if (role === "coordinator") {
      if (this.coordinatorConnection === conn) {
        this.coordinatorConnection = null;
        if (!this.stopped) {
          this.scheduleReconnect();
        }
      }
      return;
    }

    this.connections.delete(conn.peer);
    if (this.isCoordinator) {
      this.roomClaims.delete(conn.peer);
      this.rebuildRooms();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.stopped) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectOrClaim();
    }, 250);
  }

  private sendAnnouncement(): void {
    if (this.isCoordinator) {
      this.roomClaims.set(this.lobbyId, new Map(this.localRooms));
      this.rebuildRooms();
      return;
    }
    this.coordinatorConnection?.send({
      type: "announce",
      rooms: [...this.localRooms.values()],
    } satisfies DiscoveryMessage);
  }

  private sendState(conn: DataConnection): void {
    conn.send({
      type: "state",
      rooms: this.rooms,
    } satisfies DiscoveryMessage);
  }

  private rebuildRooms(): void {
    const aggregated = new Map<string, UMIL_RoomData>();

    this.roomClaims.forEach((claims) => {
      claims.forEach((room, roomId) => {
        aggregated.set(roomId, room);
      });
    });

    this.rooms = [...aggregated.values()];
    this.onRoomsChanged?.(this.getRooms());
    if (this.isCoordinator) {
      this.connections.forEach((conn) => this.sendState(conn));
    }
  }

  private syncLocalRooms(): void {
    this.sendAnnouncement();
  }

  private async destroyPeer(): Promise<void> {
    this.connections.forEach((conn) => conn.close());
    this.connections.clear();
    this.coordinatorConnection?.close();
    this.coordinatorConnection = null;
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
  }
}
