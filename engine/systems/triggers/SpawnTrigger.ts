import { ComponentCategory, DEPTHS } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { Health } from "yage/schemas/core/Health";
import { BaseTriggerSystem } from "./BaseTrigger";
import { MapId } from "yage/schemas/map/MapSpawn";
import { SpawnTrigger } from "yage/schemas/triggers/SpawnTrigger";
import { System } from "minecs";
import { Transform } from "yage/schemas/entity/Transform";

@System(SpawnTrigger, Transform)
export class SpawnTriggerSystem extends BaseTriggerSystem {
  static category: ComponentCategory = ComponentCategory.TRIGGER;
  static depth = DEPTHS.DAMAGE + 10;

  getTrigger(gameModel: GameModel, entity: number): SpawnTrigger {
    return gameModel.getTypedUnsafe(SpawnTrigger, entity);
  }

  shouldTrigger(gameModel: GameModel, entity: number): false | number[] {
    if (!super.shouldTrigger(gameModel, entity)) {
      return false;
    }
    const trigger = this.getTrigger(gameModel, entity);

    const health = gameModel.getTypedUnsafe(Health, entity);

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
            mapId: gameModel.getTyped(MapId, entity)?.mapId ?? -1,
          },
        },
      },
    ];
    return gameModel.players;
  }
}
