import { Component, Schema, System, SystemImpl, type } from "minecs";
import { DEPTHS } from "yage/constants/enums";
import { EntityFactory } from "yage/entity/EntityFactory";
import type { GameModel } from "yage/game/GameModel";
import { MappedKeys } from "yage/inputs/InputManager";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyDown } from "yage/utils/keys";
import { makePickupable } from "yage/utils/pathfinding";
import { Transform } from "yage/schemas/entity/Transform";

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
      console.log({ ...gameModel.getTypedUnsafe(Transform, entity) });

      // const targetMap = gameModel.getTyped(MapId, entity)?.mapId;
      // if (!targetMap) {
      //   return;
      // }
      // const map = gameModel.getTypedUnsafe(Map, targetMap);
      // const mapSystem = gameModel.getSystem(MapSystem);
      // const transform = gameModel.getTypedUnsafe(Transform, entity);
      // const targetPosition = { x: transform.x, y: transform.y };
      // const mapTarget = getMapPosition(map, toMapSpace(targetPosition, true), 20);

      // console.log(mapTarget, map.scale);

      const originalPosition = {
        x: gameModel.rand.float(-1500, 1500),
        y: gameModel.rand.float(0, 3000), // - 5000,
      };
      const dropPosition = makePickupable(gameModel, { ...originalPosition });

      const ball = EntityFactory.getInstance().generateEntity(gameModel, "ball", {
        Transform: dropPosition,
      });
    }
  }
}
