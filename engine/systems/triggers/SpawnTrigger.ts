import { DEPTHS, registerSystem } from "yage/components/ComponentRegistry";
import { ComponentCategory } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { HealthSchema } from "yage/schemas/core/Health";
import { BaseTriggerSystem } from "./BaseTrigger";
import { MapIdSchema } from "yage/schemas/map/MapSpawn";
import { SpawnTriggerSchema } from "yage/schemas/triggers/SpawnTrigger";

export class SpawnTriggerSystem extends BaseTriggerSystem {
  type = "SpawnTrigger";
  category: ComponentCategory = ComponentCategory.TRIGGER;
  schema = SpawnTriggerSchema;
  depth = DEPTHS.DAMAGE + 10;

  dependencies = ["Transform"];

  shouldTrigger(entity: number, gameModel: GameModel): false | number[] {
    if (!super.shouldTrigger(entity, gameModel)) {
      return false;
    }
    const trigger = gameModel.getComponent(entity, this.type) as SpawnTriggerSchema;

    const health = gameModel.getTypedUnsafe(entity, HealthSchema);

    if (health.health > 0) {
      return false;
    }

    trigger.triggerEvent = [
      {
        ...trigger.triggerEvent[0],
        event: "ENTITY",
        name: trigger.spawnName,
        overrideProperties: {
          MapId: {
            mapId: gameModel.getTyped(entity, MapIdSchema)?.mapId ?? -1,
          },
        },
      },
    ];
    return gameModel.players;
  }
}

registerSystem(SpawnTriggerSystem);
