import { DEPTHS, registerSystem } from "yage/components/ComponentRegistry";
import { ComponentCategory } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { BaseTriggerSystem } from "./BaseTrigger";
import { LocomotionSchema } from "yage/schemas/entity/Locomotion";
import { ChildSchema } from "yage/schemas/entity/Child";
import { IsMovingTriggerSchema } from "yage/schemas/triggers/IsMovingTrigger";

export class IsMovingTriggerSystem extends BaseTriggerSystem {
  type = "IsMovingTrigger";
  category: ComponentCategory = ComponentCategory.TRIGGER;
  schema = IsMovingTriggerSchema;
  depth = DEPTHS.ITEMS + 10;

  shouldTrigger(entity: number, gameModel: GameModel): false | number[] {
    if (!super.shouldTrigger(entity, gameModel)) {
      return false;
    }
    const trigger = gameModel.getComponent(entity, this.type) as IsMovingTriggerSchema;
    let parent = entity;
    if (!gameModel.hasComponent(entity, LocomotionSchema)) {
      parent = gameModel.getTypedUnsafe(entity, ChildSchema).parent!;
    }
    const isMoving = !!LocomotionSchema.store.velocityX[parent] || !!LocomotionSchema.store.velocityY[parent];
    if (isMoving !== trigger.isMoving) {
      if (isMoving) {
        trigger.startMovement = gameModel.timeElapsed;
        trigger.isMoving = true;
      } else {
        trigger.startMovement = 0;
        trigger.isMoving = false;
      }
    }

    if (gameModel.timeElapsed - trigger.startMovement < trigger.movementDelay || !trigger.isMoving) {
      return false;
    }

    return gameModel.players;
  }
}

registerSystem(IsMovingTriggerSystem);
