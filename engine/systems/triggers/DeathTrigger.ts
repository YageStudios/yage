import { DEPTHS, registerSystem } from "yage/components/ComponentRegistry";
import { ComponentCategory } from "yage/components/types";
import type { GameModel } from "yage/game/GameModel";
import { HealthSchema } from "yage/schemas/core/Health";
import { BaseTriggerSystem } from "./BaseTrigger";
import { DeathTriggerSchema } from "yage/schemas/triggers/DeathTrigger";

export class DeathTriggerSystem extends BaseTriggerSystem {
  type = "DeathTrigger";
  category: ComponentCategory = ComponentCategory.TRIGGER;
  schema = DeathTriggerSchema;
  depth = DEPTHS.DAMAGE + 10;

  dependencies = ["Transform"];

  shouldTrigger(entity: number, gameModel: GameModel): false | number[] {
    if (!super.shouldTrigger(entity, gameModel)) {
      return false;
    }

    const health = gameModel.getTypedUnsafe(entity, HealthSchema);

    if (health.health > 0) {
      return false;
    }
    return gameModel.players;
  }
}

registerSystem(DeathTriggerSystem);
