import { Socket, io } from "socket.io-client";
import { MultiplayerInstance } from "./MultiplayerInstance";
import { PlayerConnect, PlayerConnection } from "./ConnectionInstance";
import { MouseManager } from "@/inputs/MouseManager";
import { InputManager } from "@/inputs/InputManager";
import { isEqual } from "lodash";

export class SocketMultiplayerInstance<T> extends MultiplayerInstance<T> {
  socket: Socket;
  _socketSubscriptions: { event: string; once?: boolean; callback: (...args: any[]) => void }[] = [];

  constructor(
    player: PlayerConnect<T>,
    inputManager: InputManager,
    mouseManager: MouseManager,
    private socketUrl: string
  ) {
    super(player, inputManager, mouseManager);
  }

  emit(event: string, ...args: any[]) {
    this.socket.emit(event, ...args);
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

  // on(event: string, callback: (...args: any[]) => void) {
  //   const unsub = super.on(event, callback);
  //   if (!this.socket) {
  //     if (!this._socketSubscriptions) {
  //       this._socketSubscriptions = [];
  //     }
  //     this._socketSubscriptions.push({ event, callback });
  //     return () => {
  //       if (this.socket && !this.subscriptions[event]?.length) {
  //         this.socket.off(event, this.handleData);
  //       }
  //       this._socketSubscriptions = this._socketSubscriptions.filter((sub) => sub.event !== event);
  //       unsub();
  //     };
  //   } else {
  //     if (this.subscriptions[event]?.length === 1) {
  //       this.socket.on(event, (...args) => this.handleData([event, ...args]));
  //     }
  //     return () => {
  //       unsub();
  //       if (!this.subscriptions[event]?.length) {
  //         this.socket.off(event, this.handleData);
  //       }
  //     };
  //   }
  // }

  // once(event: string, callback: (...args: any[]) => void) {
  //   const unsub = super.once(event, callback);
  //   if (!this.socket) {
  //     if (!this._socketSubscriptions) {
  //       this._socketSubscriptions = [];
  //     }
  //     this._socketSubscriptions.push({ event, callback, once: true });
  //     return () => {
  //       if (this.socket && !this.onceSubscriptions[event]?.length) {
  //         this.socket.off(event, this.handleData);
  //       }
  //       this._socketSubscriptions = this._socketSubscriptions.filter((sub) => sub.event !== event);
  //       unsub();
  //     };
  //   } else {
  //     if (this.onceSubscriptions[event]?.length === 1) {
  //       this.socket.once(event, this.handleData);
  //     }
  //     return () => {
  //       unsub();
  //       if (!this.onceSubscriptions[event]?.length) {
  //         this.socket.off(event, this.handleData);
  //       }
  //     };
  //   }
  // }

  connect(): Promise<void> {
    super.connect(this.socketUrl);
    this.socket = io(this.socketUrl);
    // this.socket.on("peer", (id: string, player: PlayerConnection<T>) => {
    //   this.handleData(["peer", id, player]);
    // });
    this.socket.onAny((event, ...args) => {
      this.handleData([event, ...args]);
    });

    if (this._socketSubscriptions.length) {
      this._socketSubscriptions.forEach((sub) => {
        if (sub.once) {
          this.socket.once(sub.event, sub.callback);
        } else {
          this.socket.on(sub.event, sub.callback);
        }
      });
      this._socketSubscriptions = [];
    }

    return new Promise((resolve) => {
      this.socket.on("connect", () => {
        this.player.connected = true;
        this.emit("peer", this.player.connectionId, this.player);
        resolve();
      });
    });
  }
}
