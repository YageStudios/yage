import { ComponentCategory } from "../../components/types";
import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import type { System } from "../../components/System";
import { DieOnTimeoutSchema } from "@/schemas/timeouts/DieOnTimeout";

class DieOnTimeoutSystem implements System {
  type = "DieOnTimeout";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = DieOnTimeoutSchema;
  depth = DEPTHS.HEALTH + 1;
  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTyped(entity, DieOnTimeoutSchema);
    updateTimeout(entity, data as unknown as DieOnTimeoutSchema, gameModel);
  }
}

registerSystem(DieOnTimeoutSystem);

function updateTimeout(entity: number, timeout: DieOnTimeoutSchema, gameModel: GameModel) {
  if (timeout.endFrame === 0) {
    timeout.endFrame = gameModel.timeElapsed + timeout.timeoutMs / 1000;
  }
  if (timeout.endFrame < gameModel.timeElapsed) {
    gameModel.getComponent(entity, "Health").health = 0;
  }
}
