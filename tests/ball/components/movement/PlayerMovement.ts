import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { System } from "@/components/System";
import { ComponentCategory } from "@/components/types";
import { Component, Schema } from "@/decorators/type";
import type { GameModel } from "@/game/GameModel";
import { MappedKeys } from "@/inputs/InputManager";
import { LocomotionSchema } from "@/schemas/entity/Locomotion";
import { keyDown } from "@/utils/keys";
import { normalizeSafeVector2d } from "@/utils/vector";
import { ChildSchema } from "@/schemas/entity/Child";
import { TransformSchema } from "@/schemas/entity/Transform";
import { PlayerInputSchema } from "@/schemas/core/PlayerInput";

@Component("PlayerMovement")
export class PlayerMovementSchema extends Schema {}

export class PlayerMovementSystem implements System {
  type = "PlayerMovement";
  category: ComponentCategory = ComponentCategory.CORE;
  schema = PlayerMovementSchema;
  depth = DEPTHS.PLAYER_MOVEMENT;

  run(entity: number, gameModel: GameModel) {
    LocomotionSchema.id = entity;
    const netData = gameModel.getTyped(entity, PlayerInputSchema);
    const speed = gameModel.getTyped(entity, LocomotionSchema).speed;

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
      gameModel.queueSound("ding");
    }

    if (offset.x != 0 || offset.y != 0) {
      const direction = normalizeSafeVector2d(offset);
      LocomotionSchema.directionX = direction.x;
      LocomotionSchema.directionY = direction.y;

      offset.x = direction.x * speed;
      offset.y = direction.y * speed;
    }

    LocomotionSchema.velocityX = offset.x;
    LocomotionSchema.velocityY = offset.y;
  }
}

registerSystem(PlayerMovementSystem);
