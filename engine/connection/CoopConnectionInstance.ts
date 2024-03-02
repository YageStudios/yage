import { InputEventType, InputManager } from "@/inputs/InputManager";
import { TouchRegion } from "@/inputs/InputRegion";
import { CoreConnectionInstance } from "./CoreConnectionInstance";

export class CoopConnectionInstance<T> extends CoreConnectionInstance<T> {
  playerInputs: [InputEventType, number][];
  constructor(
    public inputManager: InputManager,
    players: [InputEventType, number, T | undefined][],
    public touchRegions?: TouchRegion[]
  ) {
    super(
      players.map((player, index) => ({
        id: "player" + index,
        name: "player" + index,
        token: "player" + index,
        inputType: player[0],
        inputIndex: player[1],
        config: player[2],
      })),
      inputManager,
      { touchRegions }
    );
    inputManager.combineKeyMaps = false;

    console.log(this.localPlayers);

    this.localPlayers.forEach((player) => {
      player.connected = true;
    });
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
