import { registerSystem } from "@/components/ComponentRegistry";
import { System } from "@/components/System";
import { ComponentCategory } from "@/constants/enums";
import { GameModel } from "@/game/GameModel";
import { Component, type, defaultValue, Schema } from "@/decorators/type";

@Component("ListenEntityCreation")
export class ListenEntityCreationSchema extends Schema {
  @type(["number"])
  @defaultValue([])
  entities: number[];

  @type("number")
  @defaultValue(-1)
  entity: number;
}

export class ListenEntityCreationSystem implements System {
  schema = ListenEntityCreationSchema;
  type = "ListenEntityCreation";

  category = ComponentCategory.ONKILL;
  dependencies = ["Child"];

  init(entity: number, gameModel: GameModel) {
    if (entity !== gameModel.coreEntity) {
      if (!gameModel.hasComponent(gameModel.coreEntity, ListenEntityCreationSchema)) {
        gameModel.setComponent(gameModel.coreEntity, ListenEntityCreationSchema);
      }
      const parentData = gameModel.getTyped(gameModel.coreEntity, ListenEntityCreationSchema);
      parentData.entities.push(entity);
    }
  }

  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTyped(entity, ListenEntityCreationSchema);
    for (let i = 0; i < data.entities.length; i++) {
      const entityId = data.entities[i];
      if (!gameModel.isActive(entityId)) {
        data.entities.splice(i, 1);
        i--;
        continue;
      }
      const onKillMods = gameModel.getComponentIdsByCategory(entityId, ComponentCategory.ONKILL);

      if (onKillMods.length) {
        for (let j = 0; j < onKillMods.length; j++) {
          const mod = gameModel.getComponent(entityId, onKillMods[j]);
          if (mod.entity !== undefined) {
            mod.entity = data.entity;
          }
          const system = gameModel.getSystem((mod as any).type);
          system.run?.(entityId, gameModel);
        }
      }
    }
  }
}

registerSystem(ListenEntityCreationSystem);
