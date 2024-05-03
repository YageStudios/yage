import type { GameModel } from "yage/game/GameModel";
import { Health } from "yage/schemas/core/Health";
import { BaseTriggerSystem } from "./BaseTrigger";
import { DeathTrigger } from "yage/schemas/triggers/DeathTrigger";
import { System } from "minecs";
import type { BaseTrigger } from "yage/schemas/triggers/BaseTrigger";
import { Transform } from "yage/schemas/entity/Transform";
import { ComponentCategory, DEPTHS } from "yage/constants/enums";

@System(DeathTrigger, Transform)
export class DeathTriggerSystem extends BaseTriggerSystem {
  static category: ComponentCategory = ComponentCategory.TRIGGER;
  static depth = DEPTHS.DAMAGE + 10;

  dependencies = ["Transform"];

  getTrigger(gameModel: GameModel, entity: number): BaseTrigger {
    return gameModel.getTypedUnsafe(DeathTrigger, entity);
  }

  shouldTrigger(gameModel: GameModel, entity: number): false | number[] {
    if (!super.shouldTrigger(gameModel, entity)) {
      return false;
    }

    const health = gameModel.getTypedUnsafe(Health, entity);

    if (health.health > 0) {
      return false;
    }
    return gameModel.players;
  }
}
