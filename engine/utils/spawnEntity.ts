import { EntityFactory } from "yage/entity/EntityFactory";
import { GameModel } from "yage/game/GameModel";
import { Spawn } from "yage/schemas/entity/Spawn";

export const spawnEntity = (gameModel: GameModel, spawn: Spawn, overrides: any = {}) => {
  const inherited: any = [];
  if (spawn.overrideComponents.length > 0) {
    spawn.overrideComponents.forEach((override) => {
      if (override.inherit) {
        inherited.push(override);
        return;
      }
      if (overrides[override.type]) {
        overrides[override.type] = { ...override.data, ...overrides[override.type] };
      } else {
        overrides[override.type] = override.data;
      }
    });
  }

  const spawnedEntity = EntityFactory.getInstance().generateEntity(gameModel, spawn.description, overrides);
  if (inherited.length > 0) {
    inherited.forEach((override: any) => {
      let overrideData = override.data;
      if (override.inherit) {
        overrideData = {
          ...gameModel.getComponent(override.type, spawnedEntity),
          ...(overrideData ?? {}),
        };
      }
      gameModel.addComponent(override.type, spawnedEntity, overrideData);
    });
  }
  return spawnedEntity;
};
