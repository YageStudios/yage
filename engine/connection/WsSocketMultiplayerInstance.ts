import { MultiplayerInstance, MultiplayerInstanceOptions } from "./MultiplayerInstance";
import { PlayerConnect, PlayerConnection } from "./ConnectionInstance";
import { MouseManager } from "@/inputs/MouseManager";
import { InputManager } from "@/inputs/InputManager";
import { isEqual } from "lodash";

export class WsSocketMultiplayerInstance<T> extends MultiplayerInstance<T> {
  socket: WebSocket;
  connectionPromise: Promise<void>;

  constructor(
    player: PlayerConnect<T>,
    inputManager: InputManager,
    mouseManager: MouseManager,
    protected options: MultiplayerInstanceOptions<T> & { host: string }
  ) {
    super(player, inputManager, mouseManager, options);
    const host = this.options.host.startsWith("localhost") ? `ws://${this.options.host}` : `wss://${this.options.host}`;
    this.socket = new WebSocket(host);
    this.connectionPromise = new Promise((resolve) => {
      this.socket.addEventListener("open", () => {
        this.player.connectionId = this.player.id;
        this.player.connected = true;
        this.lazyEmit("join", [this.options.address, this.player.connectionId, this.player]);
        resolve();
      });
    });
  }

  lazyEmit(event: string, args: any[]) {
    this.socket.send(event + JSON.stringify(args));
  }

  emit(event: string, ...args: any[]) {
    this.lazyEmit(event, args);

    if (event !== "message" && event !== "peer") {
      this.handleData([event, ...args]);
    }
  }

  handleData(data: any) {
    let [event, ...args] = data;

    if (event === "peer") {
      const peerId = args[0];
      const player = args[1];
      if (!this.players.find((p) => p.id === player.id)) {
        this.players.push(player);
        this.handleData(["connect", player]);

        if (player.id !== this.player.id) {
          this.emit("peer", this.player.connectionId, this.player);
        }
      } else if (player.id !== this.player.id) {
        const currentPlayer = this.players.find((p) => p.id === player.id);
        if (!isEqual(currentPlayer, player)) {
          this.players = this.players.map((p) => (p.id === player.id ? player : p));
          this.handleData(["reconnect", player]);

          if (player.id !== this.player.id) {
            this.emit("peer", this.player.connectionId, this.player);
          }
        }
      } else {
        this.handleData(["connect", player]);
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
  }

  async connect(): Promise<void> {
    super.connect();
    this.socket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      const eventName = event.data.substring(0, event.data.indexOf("["));
      const data = JSON.parse(event.data.substring(eventName.length));
      this.handleData([eventName, ...data]);
    };
    await this.connectionPromise;

    return Promise.resolve();
  }
}
