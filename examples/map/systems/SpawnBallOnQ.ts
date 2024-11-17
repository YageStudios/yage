import { Component, DrawSystemImpl, getSystem, Schema, System, SystemImpl, type } from "minecs";
import { DEPTHS } from "yage/constants/enums";
import { EntityFactory } from "yage/entity/EntityFactory";
import { GameInstance } from "yage/game/GameInstance";
import { GameModel } from "yage/game/GameModel";
import { MappedKeys } from "yage/inputs/InputManager";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { MapId } from "yage/schemas/map/MapSpawn";
import { keyDown } from "yage/utils/keys";
import { getMapPosition, makePickupable } from "yage/utils/pathfinding";
import { Vector2d } from "yage/utils/vector";
import * as PIXI from "pixi.js";
import { PixiViewportSystem } from "yage/systems/render/PixiViewport";
import { Transform } from "yage/schemas/entity/Transform";
import { toMapSpace } from "yage/utils/map";
import { MapSystem } from "yage/systems/map/Map";
import { Map, MapIsometric } from "yage/schemas/map/Map";

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
        x: Math.random() * 10000 - 5000,
        y: Math.random() * 10000 - 5000,
      };
      const dropPosition = makePickupable(gameModel, { ...originalPosition });

      const ball = EntityFactory.getInstance().generateEntity(gameModel, "ball", {
        Transform: dropPosition,
      });
    }
  }
}
