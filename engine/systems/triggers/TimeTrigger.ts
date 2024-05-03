import { DEPTHS, registerSystem } from "yage/components/ComponentRegistry";
import { ComponentCategory } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { BaseTriggerSystem } from "./BaseTrigger";
import { TimeTriggerSchema } from "yage/schemas/triggers/TimeTrigger";

export class TimeTriggerSystem extends BaseTriggerSystem {
  type = "TimeTrigger";
  category: ComponentCategory = ComponentCategory.TRIGGER;
  schema = TimeTriggerSchema;
  depth = DEPTHS.ITEMS + 10;

  init(entity: number, gameModel: GameModel) {
    const trigger = gameModel.getTypedUnsafe(entity, this.schema);
    trigger.initialTime = gameModel.timeElapsed;
  }

  shouldTrigger(entity: number, gameModel: GameModel): false | number[] {
    if (!super.shouldTrigger(entity, gameModel)) {
      console.log("not triggering time");
      return false;
    }
    const trigger = gameModel.getComponent(entity, this.type) as TimeTriggerSchema;

    if (gameModel.timeElapsed - trigger.initialTime < trigger.value) {
      return false;
    }

    return gameModel.players;
  }
}

registerSystem(TimeTriggerSystem);
