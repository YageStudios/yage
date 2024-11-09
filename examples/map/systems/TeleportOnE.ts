import { Component, Schema, System, SystemImpl, type } from "minecs";
import { DEPTHS } from "yage/constants/enums";
import { GameInstance } from "yage/game/GameInstance";
import { GameModel } from "yage/game/GameModel";
import { MappedKeys } from "yage/inputs/InputManager";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { MapId } from "yage/schemas/map/MapSpawn";
import { keyDown } from "yage/utils/keys";

@Component()
export class TeleportOnE extends Schema {
  @type("string")
  roomId: string;
}

@System(TeleportOnE)
export class TeleportOnESystem extends SystemImpl<GameModel> {
  static depth = DEPTHS.PLAYER_MOVEMENT;

  run(gameModel: GameModel, entity: number) {
    const netData = gameModel.getTypedUnsafe(PlayerInput, entity);

    if (keyDown([MappedKeys.USE], netData.keyMap)) {
      console.log("TeleportSystem", entity);
      const mapIdData = gameModel.getTypedUnsafe(MapId, entity);
      const data = gameModel.getTypedUnsafe(TeleportOnE, entity);
      console.log("TeleportSystem", { ...mapIdData });

      const nextRoomId = data.roomId;

      data.roomId += "_1";

      const player = gameModel.ejectEntity(entity);
      console.log(player);

      console.log([...gameModel.players]);

      gameModel.paused = true;

      // @ts-ignore
      const gameInstance = window.gameInstance as GameInstance<any>;

      // let mapInstance:
      const currentRoomId = gameInstance.options.connection.player.currentRoomId!;

      (async () => {
        gameInstance.options.connection.leaveRoom(currentRoomId!);
        setTimeout(() => {
          gameInstance.initializeRoom(currentRoomId, gameInstance.options.seed ?? "Teleport", {
            players: [netData.pid],
          });
        }, 1000);
        // await gameInstance.initializeRoom(data.roomId, gameInstance.options.seed ?? "Teleport");
        // gameInstance.gameModels[data.roomId].injectEntity(player);
      })();
    }
  }
}
