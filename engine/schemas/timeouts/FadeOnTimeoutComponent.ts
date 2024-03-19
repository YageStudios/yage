import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { System } from "@/components/System";
import { ComponentCategory } from "@/components/types";
import { Component, defaultValue, Schema, type } from "@/decorators/type";
import type { GameModel } from "@/game/GameModel";

@Component("FadeOnTimeout")
export class FadeOnTimeoutSchema extends Schema {
  @type("number")
  @defaultValue(0)
  startFrame: number;

  @type("number")
  @defaultValue(1000)
  timeout: number;

  @type("number")
  @defaultValue(1000)
  fadeMs: number;

  @type("boolean")
  @defaultValue(false)
  dieOnTimeout: boolean;
}

class FadeOnTimeoutSystem implements System {
  type = "FadeOnTimeout";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = FadeOnTimeoutSchema;
  depth = DEPTHS.HEALTH + 1;
  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTypedUnsafe(entity, FadeOnTimeoutSchema);
    if (data.startFrame === 0) {
      data.startFrame = data.timeout + data.fadeMs;
    } else {
      data.startFrame -= gameModel.frameDt;
    }

    if (data.startFrame <= data.fadeMs) {
      if (data.startFrame > 0) {
        const renderingComponents = gameModel.getComponentIdsByCategory(entity, ComponentCategory.RENDERING);
        for (let i = 0; i < renderingComponents.length; i++) {
          const componentData = gameModel.getComponent(entity, renderingComponents[i]) as any;

          if (componentData.opacity !== undefined) {
            componentData.opacity = data.startFrame / data.fadeMs;
          }
        }
      } else {
        if (data.dieOnTimeout) {
          gameModel.getComponentUnsafe(entity, "Health").health = 0;
        } else {
          gameModel.removeEntity(entity);
        }
      }
    }
  }
}
registerSystem(FadeOnTimeoutSystem);
