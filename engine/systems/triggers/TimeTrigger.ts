import { ComponentCategory, DEPTHS } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { BaseTriggerSystem } from "./BaseTrigger";
import { TimeTrigger } from "yage/schemas/triggers/TimeTrigger";
import { System } from "minecs";

@System(TimeTrigger)
export class TimeTriggerSystem extends BaseTriggerSystem {
  static category: ComponentCategory = ComponentCategory.TRIGGER;
  static depth = DEPTHS.ITEMS + 10;

  getTrigger(gameModel: GameModel, entity: number): TimeTrigger {
    return gameModel.getTypedUnsafe(TimeTrigger, entity);
  }

  init = (gameModel: GameModel, entity: number) => {
    const trigger = this.getTrigger(gameModel, entity);
    trigger.initialTime = gameModel.timeElapsed;
  };

  shouldTrigger(gameModel: GameModel, entity: number): false | number[] {
    if (!super.shouldTrigger(gameModel, entity)) {
      console.log("not triggering time");
      return false;
    }
    const trigger = this.getTrigger(gameModel, entity);

    if (gameModel.timeElapsed - trigger.initialTime < trigger.value) {
      return false;
    }

    return gameModel.players;
  }
}
