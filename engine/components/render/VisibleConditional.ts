import { GameModel } from "@/game/GameModel";
import { System } from "../System";
import { VisibleConditionalSchema } from "@/schemas/render/VisibleConditional";
import { DEPTHS, registerSystem } from "../ComponentRegistry";
import { VisibleConditionTypeEnum } from "@/constants/enums";
import { SpriteSchema } from "@/schemas/render/Sprite";
import { MapSpriteSchema } from "@/schemas/render/MapSprite";

class VisibleConditionalSystem implements System {
  type: string = "VisibleConditional";
  schema = VisibleConditionalSchema;
  depth = DEPTHS.PREDRAW;
  dependencies = ["Sprite"];
  run(entity: number, gameModel: GameModel) {
    const player = gameModel.players[0];
    if (player == undefined) {
      return;
    }
    const visibleConditional = gameModel.getComponent(entity, this.type) as VisibleConditionalSchema;
    let sprite; //gameModel.getTypedUnsafe(entity, SpriteSchema);
    if (gameModel.hasComponent(entity, "Sprite")) {
      sprite = gameModel.getTypedUnsafe(entity, SpriteSchema);
    } else if (gameModel.hasComponent(entity, "MapSprite")) {
      sprite = gameModel.getTypedUnsafe(entity, MapSpriteSchema);
    } else {
      return;
    }
    const conditions = visibleConditional.conditions;
    for (let i = 0; i < conditions.length; i++) {
      const condition = conditions[i];
      if (condition.key === "hasComponent") {
        if (gameModel.hasComponent(player, condition.component)) {
          sprite.opacity = 1;
          return;
        }
      } else {
        const component = gameModel.getComponent(player, condition.component);
        if (component) {
          const value = component[condition.key];
          if (value) {
            switch (condition.valueType) {
              case VisibleConditionTypeEnum.STRING:
                if (condition.stringValue === value) {
                  sprite.opacity = 1;
                  return;
                }
                break;
              case VisibleConditionTypeEnum.BOOLEAN:
                if (condition.booleanValue === value) {
                  sprite.opacity = 1;
                  return;
                }
                break;
              case VisibleConditionTypeEnum.NUMBER:
                if (condition.numberValue === value) {
                  sprite.opacity = 1;
                  return;
                }
                break;
            }
          }
        }
      }
    }
    sprite.opacity = 0;
  }

  cleanup(entity: number, gameModel: GameModel, ejecting: boolean) {
    if (ejecting) return;

    const sprite = gameModel.getTypedUnsafe(entity, SpriteSchema);
    sprite.opacity = 1;
  }
}

registerSystem(VisibleConditionalSystem);
