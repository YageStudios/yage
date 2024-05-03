import { ComponentCategory, DEPTHS, EnemyTypeEnum } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { Transform } from "yage/schemas/entity/Transform";
import type { KillFrame } from "yage/schemas/player/KillStats";
import { KillStats } from "yage/schemas/player/KillStats";
import { TriggerEventSystem } from "./TriggerEvent";
import { KillStatsTrigger } from "yage/schemas/triggers/KillStatsTrigger";
import { TriggerEvent } from "yage/schemas/triggers/TriggerEvent";
import { World } from "yage/schemas/core/World";
import { System, SystemImpl } from "minecs";
import { PixiSprite } from "yage/schemas/render/PixiSprite";

@System(KillStatsTrigger)
export class KillStatsTriggerSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.TRIGGER;
  static depth = DEPTHS.HEALTH + 2;

  runAll = (gameModel: GameModel) => {
    const entities = this.query(gameModel);
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      gameModel.currentWorld = gameModel(World).store.world[entity];

      const trigger = gameModel.getTypedUnsafe(KillStatsTrigger, entity);
      const playerId = gameModel.players[0];

      if (!gameModel.hasComponent(KillStats, playerId)) {
        continue;
      }

      if (trigger.disableOnHidden) {
        let sprite;
        if (gameModel.hasComponent(PixiSprite, entity)) {
          sprite = gameModel.getTypedUnsafe(PixiSprite, entity);
        } else {
          return false;
        }
        if (sprite.opacity === 0) return false;
      }

      let killFrame: KillFrame | undefined;
      const killStats = gameModel.getTypedUnsafe(KillStats, playerId);

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
              location = { x: gameModel(Transform).store.x[playerId], y: gameModel(Transform).store.y[playerId] };
              break;
            case "FRAME":
              location = killFrame.position;
              break;
          }
          const triggerEvent = gameModel.getTypedUnsafe(TriggerEvent, entity);
          triggerEvent.location = location;
          const triggered = gameModel.getSystem(TriggerEventSystem).run(gameModel, entity);
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
  };
}
