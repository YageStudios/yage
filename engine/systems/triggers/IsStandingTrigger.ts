import { ComponentCategory, DEPTHS } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { BaseTriggerSystem } from "./BaseTrigger";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { Child } from "yage/schemas/entity/Child";
import { IsStandingTrigger } from "yage/schemas/triggers/IsStandingTrigger";
import { System } from "minecs";

@System(IsStandingTrigger)
export class IsStandingTriggerSystem extends BaseTriggerSystem {
  static category: ComponentCategory = ComponentCategory.TRIGGER;
  static depth = DEPTHS.ITEMS + 10;

  getTrigger(gameModel: GameModel, entity: number): IsStandingTrigger {
    return gameModel.getTypedUnsafe(IsStandingTrigger, entity);
  }

  shouldTrigger(gameModel: GameModel, entity: number): false | number[] {
    if (!super.shouldTrigger(gameModel, entity)) {
      return false;
    }
    const trigger = this.getTrigger(gameModel, entity);
    if (!gameModel.hasComponent(Locomotion, entity)) {
      entity = gameModel.getTypedUnsafe(Child, entity).parent!;
    }
    const isMoving = !!gameModel(Locomotion).store.x[entity] || !!gameModel(Locomotion).store.y[entity];
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
