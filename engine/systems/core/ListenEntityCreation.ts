import { System, SystemImpl, addComponent } from "minecs";
import { ComponentCategory } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { ListenEntityCreation } from "yage/schemas/core/ListenEntityCreation";
import { Child } from "yage/schemas/entity/Child";

@System(ListenEntityCreation, Child)
export class ListenEntityCreationSystem extends SystemImpl<GameModel> {
  schema = ListenEntityCreation;
  type = "ListenEntityCreation";

  category = ComponentCategory.ON_KILL;
  dependencies = ["Child"];

  init = (gameModel: GameModel, entity: number) => {
    if (entity !== gameModel.coreEntity) {
      if (!gameModel.hasComponent(ListenEntityCreation, gameModel.coreEntity)) {
        addComponent(gameModel, ListenEntityCreation, gameModel.coreEntity);
      }
      const parentData = gameModel.getTypedUnsafe(ListenEntityCreation, gameModel.coreEntity);
      parentData.entities.push(entity);
    }
  };

  run = (gameModel: GameModel, entity: number) => {
    const data = gameModel.getTypedUnsafe(ListenEntityCreation, entity);
    for (let i = 0; i < data.entities.length; i++) {
      const entityId = data.entities[i];
      if (!gameModel.isActive(entityId)) {
        data.entities.splice(i, 1);
        i--;
        continue;
      }
      gameModel.runMods(entityId, ComponentCategory.ON_ENTITY_CREATION, {
        entity: entityId,
      });
    }
  };
}
