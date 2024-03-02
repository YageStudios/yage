import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import { BV2 } from "@/utils/vector";
import type { System } from "@/components/System";
import { ComponentCategory } from "../types";
import { NoLocomotionSchema } from "@/schemas/entity/NoLocomotion";
import { LocomotionSchema } from "@/schemas/entity/Locomotion";

class NoLocomotionSystem implements System {
  type = "NoLocomotion";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = NoLocomotionSchema;

  depth = DEPTHS.LOCOMOTION - 0.0000001;
  runAll(gameModel: GameModel) {
    const entities = gameModel.getComponentActives("NoLocomotion");
    for (let i = 0; i < entities.length; ++i) {
      const entity = entities[i];
      const locomotionSchema = gameModel.getTypedUnsafe(entity, LocomotionSchema);
      locomotionSchema.decayingVelocityX = 0;
      locomotionSchema.decayingVelocityY = 0;
      if (locomotionSchema.velocityX || locomotionSchema.velocityY) {
        const direction = BV2.normalizeVector2d(locomotionSchema.velocityX, locomotionSchema.velocityY);
        locomotionSchema.directionX = direction[0];
        locomotionSchema.directionY = direction[1];
        locomotionSchema.velocityX = 0;
        locomotionSchema.velocityY = 0;
      }
      locomotionSchema.decayingVelocityTime = 0;
    }
  }
}

registerSystem(NoLocomotionSystem);
