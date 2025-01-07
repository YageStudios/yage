import type { InputManager } from "yage/inputs/InputManager";
import type { TouchRegion } from "yage/inputs/InputRegion";
import { CoreConnectionInstance } from "./CoreConnectionInstance";

export class SingleplayerConnectionInstance<T> extends CoreConnectionInstance<T> {
  constructor(public inputManager: InputManager, config?: T, public touchRegions?: TouchRegion[]) {
    super(
      {
        netId: "singleplayer",
        uniqueId: "singleplayer",
        token: "singleplayer",
        config,
      },
      inputManager,
      { touchRegions, roomPersist: 500000 }
    );
  }

  emit(event: string, ...args: any[]) {
    if (event !== "message") {
      if (this.onceSubscriptions[event]) {
        this.onceSubscriptions[event].forEach((callback) => {
          callback(this.player.netId, ...args);
        });
        this.onceSubscriptions[event] = [];
      }
      if (this.subscriptions[event]) {
        this.subscriptions[event].forEach((callback) => {
          callback(this.player.netId, ...args);
        });
      }
    }
  }

  async connect(): Promise<void> {
    super.connect();
    this.player.connected = true;
    this.roomSyncResolve();
    this.player.connectionTime = Date.now();
    this.emit("connect", this.player);
  }
}
