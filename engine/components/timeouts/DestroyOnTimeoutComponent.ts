import type { ComponentDataSchema } from "../../components/types";
import { ComponentCategory } from "../../components/types";
import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import type { System } from "../../components/System";
import { EntityFactory } from "@/entity/EntityFactory";
import { OwnerSchema } from "@/schemas/core/Owner";
import { DestroyOnTimeoutSchema, MultiDestroyOnTimeoutSchema } from "@/schemas/timeouts/DestroyOnTimeoutComponent";
import type { SpawnSchema } from "@/components/entity/Spawn";

class DestroyOnTimeoutSystem implements System {
  type = "DestroyOnTimeout";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = DestroyOnTimeoutSchema;
  depth = DEPTHS.HEALTH + 1;
  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTyped(entity, DestroyOnTimeoutSchema);
    updateTimeout(entity, data as unknown as DestroyOnTimeoutSchema, gameModel);
  }
}

registerSystem(DestroyOnTimeoutSystem);

function updateTimeout(entity: number, timeout: DestroyOnTimeoutSchema, gameModel: GameModel) {
  if (timeout.endFrame === 0) {
    timeout.endFrame = gameModel.timeElapsed + timeout.timeoutMs / 1000;
  }
  if (timeout.endFrame < gameModel.timeElapsed) {
    if (timeout.spawnOnTimeout.length > 0) {
      let owner = entity;
      if (gameModel.hasComponent(entity, "Owner")) {
        owner = gameModel.getTyped(entity, OwnerSchema).owner ?? entity;
      }
      timeout.spawnOnTimeout.forEach((spawn) => {
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
              gameModel.setComponent(spawnedEntity, override.type, {
                damageAmount: 0,
                source: entity,
                owner: owner,
              });
            } else {
              let overrideData = override.data;
              if (override.inherit) {
                overrideData = { ...gameModel.getComponent(spawnedEntity, override.type), ...(overrideData ?? {}) };
              }
              gameModel.setComponent(spawnedEntity, override.type, overrideData);
            }
          }
        }
      });
    }
    if (timeout.component !== "") {
      gameModel.removeComponent(entity, timeout.component);
      if (timeout.applyOnTimeout.length > 0) {
        timeout.applyOnTimeout.forEach((apply) => {
          gameModel.setComponent(entity, apply.type, apply.data);
        });
      }
    } else {
      gameModel.removeEntity(entity);
    }
  }
}

class MultiDestroyOnTimeoutSystem implements System {
  type = "MultiDestroyOnTimeout";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = MultiDestroyOnTimeoutSchema;
  depth = DEPTHS.HEALTH + 1;
  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTyped(entity, MultiDestroyOnTimeoutSchema);
    for (let i = 0; i < data.timeouts.length; ++i) {
      const timeout = data.timeouts[i] as DestroyOnTimeoutSchema;
      updateTimeout(entity, timeout, gameModel);
    }
    if (data.timeouts.length === 0) {
      gameModel.removeComponent(entity, "MultiDestroyOnTimeout");
    }
  }
}

registerSystem(MultiDestroyOnTimeoutSystem);

export const addToDestroyOnTimeout = (
  entity: number,
  component: string | null,
  timeoutMs: number,
  gameModel: GameModel,
  spawnOnTimeout: SpawnSchema[] = [],
  applyOnTimeout: ComponentDataSchema[] = []
) => {
  if (!gameModel.hasComponent(entity, "DestroyOnTimeout")) {
    gameModel.setComponent(entity, "DestroyOnTimeout", {
      component,
      timeoutMs,
      endFrame: 0,
    });
    return;
  }

  const dotData = gameModel.getTyped(entity, DestroyOnTimeoutSchema);
  if (dotData.component === component) {
    dotData.timeoutMs = timeoutMs;
    dotData.endFrame = 0;
    return;
  }

  if (!gameModel.hasComponent(entity, "MultiDestroyOnTimeout")) {
    gameModel.setComponent(entity, "MultiDestroyOnTimeout", {
      timeouts: [
        {
          component,
          timeoutMs,
          endFrame: 0,
        },
      ],
    });
    return;
  }
  const data = gameModel.getTyped(entity, MultiDestroyOnTimeoutSchema);
  const prevIndex = data.timeouts.findIndex((t: DestroyOnTimeoutSchema) => t.component === component);
  if (prevIndex === -1) {
    const destroyOnTimeout: DestroyOnTimeoutSchema = {
      component: component || "",
      timeoutMs,
      endFrame: 0,
      spawnOnTimeout: spawnOnTimeout,
      applyOnTimeout: applyOnTimeout,
    };
    data.timeouts.push(destroyOnTimeout);
  } else {
    data.timeouts[prevIndex].timeoutMs = timeoutMs;
    data.timeouts[prevIndex].endFrame = 0;
  }
};
