import { ComponentCategory } from "yage/systems/types";
import { Component, Schema, System, SystemImpl } from "minecs";
import type { GameModel } from "yage/game/GameModel";
import { MappedKeys } from "yage/inputs/InputManager";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { keyDown } from "yage/utils/keys";
import { normalizeSafeVector2d } from "yage/utils/vector";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { DEPTHS } from "yage/constants/enums";

@Component()
export class PlayerMovement extends Schema {}

@System(PlayerMovement)
export class PlayerMovementSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.CORE;
  static depth = DEPTHS.PLAYER_MOVEMENT;

  run = (gameModel: GameModel, entity: number) => {
    const netData = gameModel.getTypedUnsafe(PlayerInput, entity);
    const locomotion = gameModel.getTypedUnsafe(Locomotion, entity);
    const speed = locomotion.speed;

    const { keyMap } = netData;
    if (!keyMap) {
      return;
    }

    const offset = {
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

    if (offset.x != 0 || offset.y != 0) {
      const direction = normalizeSafeVector2d(offset);
      locomotion.directionX = direction.x;
      locomotion.directionY = direction.y;

      offset.x = direction.x * speed;
      offset.y = direction.y * speed;
    }

    locomotion.x = offset.x;
    locomotion.y = offset.y;
  };
}
