import type { DataConnection } from "peerjs";
import Peer from "peerjs";
import type { PlayerConnect } from "./ConnectionInstance";
import { customAlphabet } from "nanoid";
import type { InputManager } from "yage/inputs/InputManager";
import type { CoreConnectionInstanceOptions } from "./CoreConnectionInstance";
import { CoreConnectionInstance } from "./CoreConnectionInstance";
import { flags } from "yage/console/flags";
import type { ManualPeer } from "./ManualPeer";

const nanoid = customAlphabet("234579ACDEFGHJKMNPQRTWXYZ", 10);

export type PeerMultiplayerInstanceOptions<T> = CoreConnectionInstanceOptions<T> & {
  prefix: string;
  requireExistingHost?: boolean;
  address?: string;
  host?: string;
  /** Replaces the PeerJS signaling server, e.g. with a ManualPeer whose link was made by swapping codes. */
  peerFactory?: (id: string) => Peer | ManualPeer;
};

export const isPeerMultiplayerInstanceOptions = <T>(
  options?: CoreConnectionInstanceOptions<T>
): options is PeerMultiplayerInstanceOptions<T> => {
  return (options as PeerMultiplayerInstanceOptions<T>)?.prefix !== undefined;
};

export class PeerMultiplayerInstance<T> extends CoreConnectionInstance<T> {
  peer: Peer;

  connections: { [peerId: string]: DataConnection } = {};
  connectionPromise: Promise<void>;
  prefix: string;
  selfAddress: string;
  private unloadDisconnectAnnounced = false;
  private requireExistingHost: boolean;
  private rejectJoin: ((error: Error) => void) | null = null;
  private peerFactory?: (id: string) => Peer | ManualPeer;

  constructor(
    player: PlayerConnect<T>,
    inputManager: InputManager,
    { prefix, host, address = nanoid(), requireExistingHost = false, peerFactory, ...coreOptions }: PeerMultiplayerInstanceOptions<T>
  ) {
    super(player, inputManager, coreOptions);
    this.prefix = prefix;
    this.address = address;
    this.requireExistingHost = requireExistingHost;
    this.peerFactory = peerFactory;

    if (!address.startsWith(this.prefix)) {
      address = this.prefix + address;
    }
    // A joining browser must never claim an absent room as its own new host.
    // connect() awaits connectionPromise; observe an early signaling failure until it attaches.
    void this.handshake(requireExistingHost ? this.prefix + nanoid() : address, host).catch(() => {});
    this.installPageDisconnectHandlers();
  }

  private installPageDisconnectHandlers(): void {
    if (typeof window === "undefined") {
      return;
    }
    const announceDisconnect = () => this.announceLocalDisconnect();
    window.addEventListener("pagehide", announceDisconnect, { capture: true });
    window.addEventListener("beforeunload", announceDisconnect, { capture: true });
  }

  private announceLocalDisconnect(): void {
    if (this.unloadDisconnectAnnounced) {
      return;
    }
    this.unloadDisconnectAnnounced = true;
    for (const player of this.localPlayers) {
      const roomId = player.currentRoomId;
      if (!roomId) {
        continue;
      }
      const gameModel = this.roomStates[roomId]?.gameModel;
      const disconnectFrame = gameModel ? gameModel.frame + this.frameOffset : undefined;
      for (const conn of Object.values(this.connections)) {
        try {
          conn.send([player.netId, "userDisconnect", player.netId, disconnectFrame]);
        } catch {
          // Browser unload can tear down the data channel before this best-effort send completes.
        }
      }
    }
  }

  async handshake(address: string, hostUrl?: string) {
    this.selfAddress = address;

    if (this.peerFactory) {
      // ManualPeer implements the part of Peer this class uses.
      this.peer = this.peerFactory(address) as Peer;
      this.selfAddress = this.peer.id;
    } else if (hostUrl) {
      const host = hostUrl.split(":")[0];
      const port = parseInt((hostUrl.split(":")[1] || "443").split("/")[0]);
      const path = hostUrl.split("/")[1] || "/";
      // Public signaling on port 443 needs TLS even when the game page was opened over HTTP.
      const secure = port === 443 || (typeof location !== "undefined" && location.protocol === "https:");

      this.peer = new Peer(address, {
        host,
        port,
        path,
        secure,
      });
    } else {
      this.peer = new Peer(address);
    }

    let self_resolve: () => void;
    let rejectHandshake: (error: Error) => void;
    let handshakeFailed = false;

    this.connectionPromise = new Promise((resolve, reject) => {
      self_resolve = resolve;
      rejectHandshake = reject;
      this.peer.on("open", (id) => {
        if (handshakeFailed) return;
        this.player.connectionId = id;
        console.log("My peer ID is: " + id);
        resolve();
      });
    });

    this.peer.on("connection", (conn) => {
      this.peer.off("error");
      this.handleConnection(conn);
    });

    this.peer.on("error", (err) => {
      console.log("peer error", err.message);
      if (this.requireExistingHost && err.type !== "unavailable-id") {
        const error = new Error("Room unavailable or running a different game build.");
        handshakeFailed = true;
        rejectHandshake(error);
        this.rejectJoin?.(error);
        if (!this.peer.destroyed) this.peer.destroy();
        return;
      }
      this.peer.destroy();
      this.handshake(this.prefix + nanoid(), hostUrl).then(() => {
        self_resolve();
      }, rejectHandshake);
    });

    await this.connectionPromise;
  }

  emit(event: string, ...args: any[]) {
    Object.values(this.connections).forEach((conn) => {
      // @ts-ignore
      if (window.simulatedDelay) {
        setTimeout(() => {
          conn.send([this.player.netId, event, ...args]);
          // @ts-ignore
        }, window.simulatedDelay);
      } else {
        conn.send([this.player.netId, event, ...args]);
      }
    });
    if (event !== "message") {
      this.handleData([this.player.netId, event, ...args]);
    }
  }

  handleData = (data: any) => {
    const [playerId, event, ...args] = data as [string, string, ...any[]];

    if (event !== "frame" && flags.DEBUG) {
      console.info("received", event, args);
    }

    if (event === "peer") {
      const peerId = args[0];
      const player = args[1];
      if (!this.connections[peerId]) {
        const conn = this.peer.connect(peerId);
        this.handleConnection(conn);
      }
      if (!this.players.find((p) => p.netId === player.netId)) {
        this.players.push(player);
        this.handleData([playerId, "connect", player]);
      } else if (player.netId !== this.player.netId) {
        this.players = this.players.map((p) => (p.netId === player.netId ? player : p));
        this.handleData([playerId, "reconnect", player]);
      }
      return;
    }

    if (this.onceSubscriptions[event]) {
      this.onceSubscriptions[event].forEach((callback) => {
        callback(playerId, ...args);
      });
      this.onceSubscriptions[event] = [];
    }
    if (this.subscriptions[event]) {
      this.subscriptions[event].forEach((callback) => {
        callback(playerId, ...args);
      });
    }
  };

  handleConnection = (conn: DataConnection) => {
    conn.on("data", (...data) => this.handleData(...data));
    conn.on("error", (err) => {
      console.error(err);
    });
    conn.on("open", () => {
      if (!this.connections[conn.peer]) {
        this.connections[conn.peer] = conn;
        if (!this.player.connected) {
          this.player.connected = true;
          this.player.connectionTime = Date.now();
          this.player.connectionId = this.peer.id;

          this.emit("peer", this.peer.id, this.player);
          this.handleData([this.player.netId, "connect", this.player]);
        } else {
          this.players.forEach((player) => {
            this.emit("peer", player.connectionId, player);
          });
        }
      }
    });
    const handleDisconnect = () => {
      delete this.connections[conn.peer];
      const player = this.players.find((p) => p.connectionId === conn.peer);
      if (player) {
        this.players = this.players.filter((p) => p.connectionId !== conn.peer);
        this.handleData([player.netId, "userDisconnect"]);
        if (this.players.length === 1) {
          this.player.connected = false;
          this.player.connectionTime = 0;
        }
      }
    };
    conn.on("iceStateChanged", (state) => {
      if (state === "disconnected") {
        handleDisconnect();
      }
    });
    conn.on("close", () => {
      handleDisconnect();
    });
  };

  async connect(): Promise<void> {
    super.connect();
    let address = this.address;
    if (!address.startsWith(this.prefix)) {
      address = this.prefix + address;
    }
    await this.connectionPromise;
    if (this.selfAddress === address) {
      if (this.requireExistingHost) {
        this.peer.destroy();
        return Promise.reject(new Error("Room unavailable or running a different game build."));
      }
      this.player.connected = true;
      this.roomSyncResolve();
      return;
    }
    const conn = this.peer.connect(address);

    return new Promise((resolve, reject) => {
      // ICE negotiation can exceed a second on mobile networks after signaling opens.
      let finished = false;
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        clearTimeout(failTimeout);
        this.rejectJoin = null;
        conn.close();
        if (this.requireExistingHost) this.peer.destroy();
        reject(error);
      };
      const failTimeout = setTimeout(() => fail(new Error(this.requireExistingHost
        ? "Room unavailable or running a different game build."
        : "Connection timed out")), 10000);
      this.rejectJoin = fail;
      console.log(address, "connecting to host");

      this.handleConnection(conn);

      conn.once("open", () => {
        if (finished) return;
        finished = true;
        clearTimeout(failTimeout);
        this.rejectJoin = null;
        this.connections[conn.peer] = conn;

        const player = this.player;
        if (player) {
          player.connected = true;
          player.connectionTime = Date.now();
          player.connectionId = this.peer.id;
        }
        this.emit("peer", conn.peer, player);
        resolve();
      });
    });
  }
}
