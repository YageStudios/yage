import { DEPTHS, registerSystem } from "yage/components/ComponentRegistry";
import type { System } from "yage/components/System";
import { ComponentCategory } from "yage/components/types";
import { EnemyTypeEnum } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { TransformSchema } from "yage/schemas/entity/Transform";
import type { KillFrameSchema, KillStatsSchema } from "yage/schemas/player/KillStats";
import { TriggerEventSystem } from "./TriggerEvent";
import { MapSpriteSchema } from "yage/schemas/render/MapSprite";
import { SpriteSchema } from "yage/schemas/render/Sprite";
import { KillStatsTriggerSchema } from "yage/schemas/triggers/KillStatsTrigger";
import { TriggerEventSchema } from "yage/schemas/triggers/TriggerEvent";
import { WorldSchema } from "yage/schemas/core/World";

export class KillStatsTriggerSystem implements System {
  type = "KillStatsTrigger";
  category: ComponentCategory = ComponentCategory.TRIGGER;
  schema = KillStatsTriggerSchema;
  depth = DEPTHS.HEALTH + 2;
  dependencies?: string[] | undefined;

  runAll(gameModel: GameModel): void {
    const entities = gameModel.getComponentActives(this.type);
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      gameModel.currentWorld = WorldSchema.store.world[entity];

      const trigger = gameModel.getComponent(entity, this.type) as KillStatsTriggerSchema;
      const playerId = gameModel.players[0];

      if (!gameModel.hasComponent(playerId, "KillStats")) {
        continue;
      }

      if (trigger.disableOnHidden) {
        let sprite; //gameModel.getTypedUnsafe(entity, SpriteSchema);
        if (gameModel.hasComponent(entity, "Sprite")) {
          sprite = gameModel.getTypedUnsafe(entity, SpriteSchema);
        } else if (gameModel.hasComponent(entity, "MapSprite")) {
          sprite = gameModel.getTypedUnsafe(entity, MapSpriteSchema);
        } else {
          continue;
        }
        if (sprite.opacity === 0) continue;
      }

      let killFrame: KillFrameSchema | undefined;
      const killStats = gameModel.getComponent(playerId, "KillStats") as KillStatsSchema;

      const kills = killStats.kills[trigger.enemyType] || 0;
      const prevKills = killStats.previousStats.kills[trigger.enemyType] || 0;
      let shouldTrigger = false;

      if (trigger.description) {
        killFrame = killStats.killsThisFrame?.find((kill) => kill.description === trigger.description);
        if (killFrame) {
          shouldTrigger = true;
        }
      } else {
        if (kills >= trigger.value && prevKills < trigger.value) {
          shouldTrigger = true;
        }
      }

      if (shouldTrigger) {
        const killsToTrigger = trigger.value - prevKills;
        if (!killFrame) {
          if (trigger.enemyType === EnemyTypeEnum.ALL) {
            killFrame = killStats.killsThisFrame?.[killsToTrigger - 1];
          } else {
            killFrame = killStats.killsThisFrame?.filter((kill) => kill.type === trigger.enemyType)[killsToTrigger - 1];
          }
        }

        if (killFrame) {
          let location = trigger.location;
          switch (trigger.locationType) {
            case "PLAYER":
              location = { x: TransformSchema.store.x[playerId], y: TransformSchema.store.y[playerId] };
              break;
            case "FRAME":
              location = killFrame.position;
              break;
          }
          const triggerEvent = gameModel.getTypedUnsafe(entity, TriggerEventSchema);
          triggerEvent.location = location;
          const triggered = gameModel.getSystem(TriggerEventSystem).run(entity, gameModel);
          if (triggered) {
            trigger.triggerCount++;

            if (
              trigger.destroyOnTrigger &&
              ((trigger.triggerType === "ALLPLAYERS" && trigger.triggerCount === gameModel.players.length) ||
                trigger.triggerType === "NONE")
            ) {
              gameModel.removeEntity(entity);
            }
          }
        }
      }
    }
  }
}

registerSystem(KillStatsTriggerSystem);
