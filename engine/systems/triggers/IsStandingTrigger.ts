import { DEPTHS, registerSystem } from "yage/components/ComponentRegistry";
import { ComponentCategory } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { BaseTriggerSystem } from "./BaseTrigger";
import { LocomotionSchema } from "yage/schemas/entity/Locomotion";
import { ChildSchema } from "yage/schemas/entity/Child";
import { IsStandingTriggerSchema } from "yage/schemas/triggers/IsStandingTrigger";

export class IsStandingTriggerSystem extends BaseTriggerSystem {
  type = "IsStandingTrigger";
  category: ComponentCategory = ComponentCategory.TRIGGER;
  schema = IsStandingTriggerSchema;
  depth = DEPTHS.ITEMS + 10;

  shouldTrigger(entity: number, gameModel: GameModel): false | number[] {
    if (!super.shouldTrigger(entity, gameModel)) {
      return false;
    }
    const trigger = gameModel.getComponent(entity, this.type) as IsStandingTriggerSchema;
    if (!gameModel.hasComponent(entity, LocomotionSchema)) {
      entity = gameModel.getTypedUnsafe(entity, ChildSchema).parent!;
    }
    const isMoving = !!LocomotionSchema.store.velocityX[entity] || !!LocomotionSchema.store.velocityY[entity];
    if (isMoving !== trigger.isMoving) {
      if (isMoving) {
        trigger.stopMovement = gameModel.timeElapsed;
        trigger.isMoving = true;
      } else {
        trigger.stopMovement = 0;
        trigger.isMoving = false;
      }
    }

    if (gameModel.timeElapsed - trigger.stopMovement < trigger.movementDelay || trigger.isMoving) {
      return false;
    }

    return gameModel.players;
  }
}

registerSystem(IsStandingTriggerSystem);
