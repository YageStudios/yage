import type { ComponentDataSchema } from "../../components/types";
import { ComponentCategory } from "../../components/types";
import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import type { System } from "../../components/System";
import { EntityFactory } from "@/entity/EntityFactory";
import { OwnerSchema } from "@/schemas/core/Owner";
import { SpawnOnTimeoutSchema, MultiSpawnOnTimeoutSchema } from "@/schemas/timeouts/SpawnOnTimeoutComponent";
import type { SpawnSchema } from "@/components/entity/Spawn";

class SpawnOnTimeoutSystem implements System {
  type = "SpawnOnTimeout";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = SpawnOnTimeoutSchema;
  depth = DEPTHS.HEALTH + 1;
  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTypedUnsafe(entity, SpawnOnTimeoutSchema);
    updateTimeout(entity, data as unknown as SpawnOnTimeoutSchema, gameModel);
  }
}

registerSystem(SpawnOnTimeoutSystem);

function updateTimeout(entity: number, timeout: SpawnOnTimeoutSchema, gameModel: GameModel) {
  timeout.timeElapsed += gameModel.dt<number>(entity);
  if (timeout.timeElapsed > timeout.timeout && !timeout.timedOut) {
    if (timeout.spawn.length > 0) {
      let owner = entity;
      if (gameModel.hasComponent(entity, "Owner")) {
        owner = gameModel.getTypedUnsafe(entity, OwnerSchema).owner ?? entity;
      }
      (timeout.spawn as SpawnSchema[]).forEach((spawn) => {
        const spawnedEntity = EntityFactory.getInstance().generateEntity(gameModel, spawn.description, {
          SourceStats: {
            damageAmount: 0,
            source: entity,
            owner: owner,
          },
        });

        if (spawn.overrideComponents.length > 0) {
          for (let i = 0; i < spawn.overrideComponents.length; i++) {
            const override = spawn.overrideComponents[i];
            if (override.type === "SourceStats") {
              gameModel.addComponent(spawnedEntity, override.type, {
                damageAmount: 0,
                source: entity,
                owner: owner,
              });
            } else {
              let overrideData = override.data;
              if (override.inherit) {
                overrideData = { ...gameModel.getComponent(spawnedEntity, override.type), ...(overrideData ?? {}) };
              }
              gameModel.addComponent(spawnedEntity, override.type, overrideData);
            }
          }
        }
      });
    }
    timeout.timedOut = true;
  }
}

class MultiSpawnOnTimeoutSystem implements System {
  type = "MultiSpawnOnTimeout";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = MultiSpawnOnTimeoutSchema;
  depth = DEPTHS.HEALTH + 1;
  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTypedUnsafe(entity, MultiSpawnOnTimeoutSchema);
    for (let i = 0; i < data.timeouts.length; ++i) {
      const timeout = data.timeouts[i] as SpawnOnTimeoutSchema;
      updateTimeout(entity, timeout, gameModel);
      if (timeout.timedOut) {
        data.timeouts.splice(i, 1);
        i--;
      }
    }
    if (data.timeouts.length === 0) {
      gameModel.removeComponent(entity, "MultiSpawnOnTimeout");
    }
  }
}

registerSystem(MultiSpawnOnTimeoutSystem);

export const addToSpawnOnTimeout = (
  entity: number,
  timeout: number,
  gameModel: GameModel,
  spawnOnTimeout: SpawnSchema[] = [],
  applyOnTimeout: ComponentDataSchema[] = []
) => {
  if (!gameModel.hasComponent(entity, "SpawnOnTimeout")) {
    gameModel.addTyped(entity, SpawnOnTimeoutSchema, {
      timeout,
      timeElapsed: 0,
      spawn: spawnOnTimeout,
    });
    return;
  }

  if (!gameModel.hasComponent(entity, "MultiSpawnOnTimeout")) {
    gameModel.addComponent(entity, "MultiSpawnOnTimeout", {
      timeouts: [
        {
          timeout,
          timeElapsed: 0,
          spawn: spawnOnTimeout,
        },
      ],
    });
    return;
  }
  const data = gameModel.getTypedUnsafe(entity, MultiSpawnOnTimeoutSchema);
  const spawnString = JSON.stringify(spawnOnTimeout);
  const prevIndex = data.timeouts.findIndex((t: SpawnOnTimeoutSchema) => JSON.stringify(t.spawn) === spawnString);
  if (prevIndex === -1) {
    const SpawnOnTimeout: SpawnOnTimeoutSchema = {
      timeout,
      timedOut: false,
      timeElapsed: 0,
      spawn: spawnOnTimeout,
    };
    data.timeouts.push(SpawnOnTimeout);
  } else {
    data.timeouts[prevIndex].timeout = timeout;
    data.timeouts[prevIndex].timeElapsed = 0;
  }
};
