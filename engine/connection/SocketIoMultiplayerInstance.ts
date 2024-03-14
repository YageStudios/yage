import { Socket, io } from "socket.io-client";
import { PlayerConnect } from "./ConnectionInstance";
import { InputManager } from "@/inputs/InputManager";
import { CoreConnectionInstance, CoreConnectionInstanceOptions } from "./CoreConnectionInstance";
import { isEqual } from "lodash";

export class SocketIoMultiplayerInstance<T> extends CoreConnectionInstance<T> {
  socket: Socket;

  constructor(
    player: PlayerConnect<T>,
    inputManager: InputManager,
    protected options: CoreConnectionInstanceOptions<T> & { address: string; host: string }
  ) {
    super(player, inputManager, options);
    this.socket = io(this.options.host);
    this.player.connectionId = this.player.netId;
    this.player.connected = true;
    this.socket.emit("join", this.options.address, this.player.connectionId, this.player);
  }

  emit(event: string, ...args: any[]) {
    // this.socket.emit(event, ...args);
    if (event !== "message" && event !== "peer") {
      this.handleData([event, ...args]);
    }
  }

  handleData(data: any) {
    let [event, ...args] = data;

    if (event === "peer") {
      const peerId = args[0];
      const player = args[1];
      if (!this.players.find((p) => p.netId === player.netId)) {
        this.players.push(player);
        this.handleData(["connect", player]);

        if (player.netId !== this.player.netId) {
          this.emit("peer", this.player.connectionId, this.player);
        }
      } else if (player.netId !== this.player.netId) {
        const currentPlayer = this.players.find((p) => p.netId === player.netId);
        if (!isEqual(currentPlayer, player)) {
          this.players = this.players.map((p) => (p.netId === player.netId ? player : p));
          this.handleData(["reconnect", player]);

          if (player.netId !== this.player.netId) {
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

  connect(): Promise<void> {
    super.connect();

    this.socket.onAny((event, ...args) => {
      this.handleData([event, ...args]);
    });

    return Promise.resolve();
  }
}
