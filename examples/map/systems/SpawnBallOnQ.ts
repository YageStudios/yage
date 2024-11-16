import { Component, Schema, System, SystemImpl, type } from "minecs";
import { Transform } from "pixi.js";
import { DEPTHS } from "yage/constants/enums";
import { EntityFactory } from "yage/entity/EntityFactory";
import { GameInstance } from "yage/game/GameInstance";
import { GameModel } from "yage/game/GameModel";
import { MappedKeys } from "yage/inputs/InputManager";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { MapId } from "yage/schemas/map/MapSpawn";
import { keyDown } from "yage/utils/keys";
import { makePickupable } from "yage/utils/pathfinding";

@Component()
export class SpawnBallOnQ extends Schema {
  @type("string")
  roomId: string;
}

@System(SpawnBallOnQ)
export class SpawnBallOnQSystem extends SystemImpl<GameModel> {
  static depth = DEPTHS.PLAYER_MOVEMENT;

  run(gameModel: GameModel, entity: number) {
    const netData = gameModel.getTypedUnsafe(PlayerInput, entity);

    if (keyDown([MappedKeys.USE], netData.keyMap)) {
      const dropPosition = makePickupable(gameModel, {
        x: Math.random() * 10000 - 5000,
        y: Math.random() * 10000 - 5000,
      });
      console.log(dropPosition);
      EntityFactory.getInstance().generateEntity(gameModel, "ball", {
        Transform: dropPosition,
      });
      //   console.log("TeleportSystem", entity);
      //   const mapIdData = gameModel.getTypedUnsafe(MapId, entity);
      //   gameModel.removeComponent(MapId, entity);
      //   const data = gameModel.getTypedUnsafe(SpawnBallOnQ, entity);
      //   console.log("TeleportSystem", { ...mapIdData });

      //   const nextRoomId = gameModel.roomId === "QuickStart" ? "room" : "QuickStart";

      //   data.roomId += "_1";

      //   const ejectedPlayer = gameModel.ejectEntity(entity);

      //   gameModel.paused = true;

      //   // @ts-ignore
      //   const gameInstance = window.gameInstance as GameInstance<any>;

      //   // let mapInstance:
      //   const currentRoomId = gameInstance.options.connection.player.currentRoomId!;

      //   (async () => {
      //     gameInstance.options.connection.leaveRoom(currentRoomId!);
      //     const player = gameInstance.options.connection.localPlayers.find((p) => p.netId === netData.pid);
      //     gameInstance.options.connection.updatePlayerConnect({
      //       name: player?.netId,
      //       config: {
      //         ejectedPlayer,
      //         map: mapIdData.map === "intro" ? "intro2" : "intro",
      //       },
      //     });
      //     gameInstance.initializeRoom(nextRoomId, gameInstance.options.seed ?? "Teleport", {
      //       players: [netData.pid],
      //     });
      //     // await gameInstance.initializeRoom(data.roomId, gameInstance.options.seed ?? "Teleport");
      //     // gameInstance.gameModels[data.roomId].injectEntity(player);
      //   })();
    }
  }
}
