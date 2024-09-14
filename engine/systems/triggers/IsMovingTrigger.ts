import { ComponentCategory, DEPTHS } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { BaseTriggerSystem } from "./BaseTrigger";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { Child } from "yage/schemas/entity/Child";
import { IsMovingTrigger } from "yage/schemas/triggers/IsMovingTrigger";
import { System } from "minecs";

@System(IsMovingTrigger)
export class IsMovingTriggerSystem extends BaseTriggerSystem {
  static category: ComponentCategory = ComponentCategory.TRIGGER;
  static depth = DEPTHS.ITEMS + 10;

  getTrigger(gameModel: GameModel, entity: number): IsMovingTrigger {
    return gameModel.getTypedUnsafe(IsMovingTrigger, entity);
  }

  shouldTrigger(gameModel: GameModel, entity: number): false | number[] {
    if (!super.shouldTrigger(gameModel, entity)) {
      return false;
    }
    const trigger = this.getTrigger(gameModel, entity);
    let parent = entity;
    if (!gameModel.hasComponent(Locomotion, entity)) {
      parent = gameModel.getTypedUnsafe(Child, entity).parent!;
    }
    const isMoving = !!gameModel(Locomotion).store.x[parent] || !!gameModel(Locomotion).store.y[parent];
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
