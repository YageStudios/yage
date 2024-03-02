import Peer, { DataConnection } from "peerjs";
import { PlayerConnect } from "./ConnectionInstance";
import { customAlphabet } from "nanoid";
import { InputManager } from "@/inputs/InputManager";
import { CoreConnectionInstance, CoreConnectionInstanceOptions } from "./CoreConnectionInstance";

const nanoid = customAlphabet("234579ACDEFGHJKMNPQRTWXYZ", 10);

type PeerMultiplayerInstanceOptions<T> = CoreConnectionInstanceOptions<T> & {
  prefix: string;
  address?: string;
  host?: string;
};

export class PeerMultiplayerInstance<T> extends CoreConnectionInstance<T> {
  peer: Peer;

  connections: { [peerId: string]: DataConnection } = {};
  connectionPromise: Promise<void>;
  prefix: string;
  selfAddress: string;

  constructor(
    player: PlayerConnect<T>,
    inputManager: InputManager,
    { solohost, prefix, host, address = nanoid() }: PeerMultiplayerInstanceOptions<T>
  ) {
    super(player, inputManager, { solohost });
    this.prefix = prefix;
    this.address = address;

    if (!address.startsWith(this.prefix)) {
      address = this.prefix + address;
    }
    this.handshake(address, host);
  }

  async handshake(address: string, hostAddress?: string) {
    this.selfAddress = address;

    if (hostAddress) {
      const host = hostAddress.split(":")[0];
      const port = parseInt((hostAddress.split(":")[1] || "443").split("/")[0]);
      const path = hostAddress.split("/")[1] || "/";

      this.peer = new Peer(address, {
        host,
        port,
        path,
        secure: true,
      });
    } else {
      this.peer = new Peer(address);
    }

    let self_resolve: any;

    this.connectionPromise = new Promise((resolve) => {
      self_resolve = resolve;
      this.peer.on("open", (id) => {
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
      this.peer.destroy();
      this.handshake(this.prefix + nanoid(), hostAddress).then(() => {
        self_resolve();
      });
    });

    await this.connectionPromise;
  }

  emit(event: string, ...args: any[]) {
    Object.entries(this.connections).forEach(([peerId, conn]) => {
      // @ts-ignore
      if (window.simulatedDelay) {
        setTimeout(() => {
          conn.send([event, ...args]);
          // @ts-ignore
        }, window.simulatedDelay);
      } else {
        conn.send([event, ...args]);
      }
    });
    if (event !== "message") {
      this.handleData([event, ...args]);
    }
  }

  handleData = (data: any) => {
    let [event, ...args] = data as [string, ...any[]];

    if (event !== "frame") {
      console.log(event, args);
    }

    if (event === "peer") {
      const peerId = args[0];
      const player = args[1];
      if (!this.connections[peerId]) {
        const conn = this.peer.connect(peerId);
        this.handleConnection(conn);
      }
      if (!this.players.find((p) => p.id === player.id)) {
        this.players.push(player);
        this.handleData(["connect", player]);
      } else if (player.id !== this.player.id) {
        this.players = this.players.map((p) => (p.id === player.id ? player : p));
        this.handleData(["reconnect", player]);
      }
      return;
    }

    if (this.onceSubscriptions[event]) {
      this.onceSubscriptions[event].forEach((callback) => {
        callback(...args);
      });
      this.onceSubscriptions[event] = [];
    }
    if (this.subscriptions[event]) {
      this.subscriptions[event].forEach((callback) => {
        callback(...args);
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
          this.handleData(["connect", this.player]);
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
        this.handleData(["userDisconnect", player.id]);
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
      return;
    }
    const conn = this.peer.connect(address);

    return new Promise((resolve, reject) => {
      const failTimeout = setTimeout(() => {
        conn.close();
        reject("Connection timed out");
      }, 1000);
      console.log(address, "connecting to host");

      this.handleConnection(conn);

      conn.once("open", () => {
        clearTimeout(failTimeout);
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
