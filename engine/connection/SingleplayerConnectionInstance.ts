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
    this.player.connected = true;
  }

  emit(event: string, ...args: any[]) {
    if (event !== "message") {
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
  }
}
