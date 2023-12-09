import { Socket, io } from "socket.io-client";
import { MultiplayerInstance } from "./MultiplayerInstance";
import { PlayerConnect } from "./ConnectionInstance";
import { MouseManager } from "@/inputs/MouseManager";
import { InputManager } from "@/inputs/InputManager";

export class SocketMultiplayerInstance extends MultiplayerInstance {
  socket: Socket;

  constructor(
    player: PlayerConnect,
    inputManager: InputManager,
    mouseManager: MouseManager,
    private socketUrl: string
  ) {
    super(player, inputManager, mouseManager);
  }

  emit(event: string, ...args: any[]) {
    this.socket.emit(event, ...args);
  }

  on(event: string, callback: (...args: any[]) => void) {
    this.socket.on(event, callback);
    return () => this.socket.off(event, callback);
  }

  once(event: string, callback: (...args: any[]) => void) {
    this.socket.once(event, callback);
    return () => this.socket.off(event, callback);
  }

  connect(): Promise<void> {
    super.connect(this.socketUrl);
    this.socket = io(this.socketUrl);

    return new Promise((resolve) => {
      this.socket.on("connect", () => {
        this.player.connected = true;
        resolve();
      });
    });
  }
}
