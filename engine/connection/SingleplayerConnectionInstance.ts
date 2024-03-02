import { InputManager } from "@/inputs/InputManager";
import { TouchRegion } from "@/inputs/InputRegion";
import { CoreConnectionInstance } from "./CoreConnectionInstance";

export class SingleplayerConnectionInstance<T> extends CoreConnectionInstance<T> {
  constructor(public inputManager: InputManager, config?: T, public touchRegions?: TouchRegion[]) {
    super(
      {
        id: "singleplayer",
        name: "singleplayer",
        token: "singleplayer",
        config,
      },
      inputManager,
      { touchRegions }
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
