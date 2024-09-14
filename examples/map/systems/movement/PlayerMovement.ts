import { ComponentCategory } from "yage/systems/types";
import { Component, Schema, System, SystemImpl } from "minecs";
import type { GameModel } from "yage/game/GameModel";
import { MappedKeys } from "yage/inputs/InputManager";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { keyDown } from "yage/utils/keys";
import { normalizeSafeVector2d, rotateDegVector2d } from "yage/utils/vector";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { DEPTHS } from "yage/constants/enums";
import { MapIsometric } from "yage/schemas/map/Map";

@Component()
export class PlayerMovement extends Schema {}

@System(PlayerMovement)
export class PlayerMovementSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.CORE;
  static depth = DEPTHS.PLAYER_MOVEMENT;

  run = (gameModel: GameModel, entity: number) => {
    const isIso = gameModel.hasComponent(MapIsometric, gameModel.coreEntity);
    const netData = gameModel.getTypedUnsafe(PlayerInput, entity);
    const locomotion = gameModel.getTypedUnsafe(Locomotion, entity);
    const speed = locomotion.speed;

    const { keyMap } = netData;
    if (!keyMap) {
      return;
    }

    let offset = {
      x: 0,
      y: 0,
    };

    if (keyDown([MappedKeys.ARROW_DOWN, MappedKeys.ARROW_DOWN_ALT], netData.keyMap)) {
      offset.y = 1;
    } else if (keyDown([MappedKeys.ARROW_UP, MappedKeys.ARROW_UP_ALT], netData.keyMap)) {
      offset.y = -1;
    }
    if (keyDown([MappedKeys.ARROW_LEFT, MappedKeys.ARROW_LEFT_ALT], netData.keyMap)) {
      offset.x = -1;
    }
    if (keyDown([MappedKeys.ARROW_RIGHT, MappedKeys.ARROW_RIGHT_ALT], netData.keyMap)) {
      offset.x = 1;
    }
    if (
      keyDown([MappedKeys.ARROW_DOWN_ALT], netData.keyMap) &&
      keyDown([MappedKeys.ARROW_LEFT_ALT], netData.keyMap) &&
      keyDown([MappedKeys.ARROW_RIGHT_ALT], netData.keyMap)
    ) {
      // gameModel.queueSound("ding");
    }

    if (isIso) {
      if (offset.x != 0 || offset.y != 0) {
        if (offset.x != 0 && offset.y != 0) {
          // snap to closest 26.565 degree angle
          if (offset.x < 0 && offset.y < 0) {
            offset = rotateDegVector2d({ x: 0, y: -1 }, -63.435);
          } else if (offset.x < 0 && offset.y > 0) {
            offset = rotateDegVector2d({ x: 0, y: -1 }, -116.565);
          } else if (offset.x > 0 && offset.y < 0) {
            offset = rotateDegVector2d({ x: 0, y: -1 }, 63.435);
          } else {
            offset = rotateDegVector2d({ x: 0, y: -1 }, 116.565);
          }
        }
  
        const direction = normalizeSafeVector2d(offset);
        locomotion.directionX = direction.x;
        locomotion.directionY = direction.y;
  
        offset.x = direction.x * speed;
        offset.y = direction.y * speed;
      }
  
    } else if (offset.x != 0 || offset.y != 0) {
      const direction = normalizeSafeVector2d(offset);
      locomotion.directionX = direction.x;
      locomotion.directionY = direction.y;

      offset.x = direction.x * speed;
      offset.y = direction.y * speed;
    }
    console.log(offset)

    locomotion.x = offset.x;
    locomotion.y = offset.y;
  };
}
