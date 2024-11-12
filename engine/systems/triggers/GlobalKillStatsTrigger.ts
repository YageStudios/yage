import { ComponentCategory, DEPTHS, EnemyTypeEnum } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { Transform } from "yage/schemas/entity/Transform";
import { TriggerEventSystem } from "./TriggerEvent";
import { PixiSprite } from "yage/schemas/render/PixiSprite";
import { GlobalKillStats, type KillFrame } from "yage/schemas/player/KillStats";
import { GlobalKillStatsTrigger } from "yage/schemas/triggers/GlobalKillStatsTrigger";
import { TriggerEvent } from "yage/schemas/triggers/TriggerEvent";
import { System, SystemImpl } from "minecs";

@System(GlobalKillStatsTrigger)
export class GlobalKillStatsTriggerSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.TRIGGER;
  static depth = DEPTHS.HEALTH + 2;

  runAll = (gameModel: GameModel) => {
    const entities = this.query(gameModel);
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      const trigger = gameModel.getTypedUnsafe(GlobalKillStatsTrigger, entity);

      if (trigger.disableOnHidden) {
        let sprite; //gameModel.getTyped(entity, Sprite);
        if (gameModel.hasComponent(PixiSprite, entity)) {
          sprite = gameModel.getTyped(PixiSprite, entity);
        } else {
          continue;
        }
        if (sprite?.opacity === 0) continue;
      }

      for (let j = 0; j < gameModel.players.length; j++) {
        const playerId = gameModel.players[j];

        let killFrame: KillFrame | null = null;
        const killStats = gameModel.getTypedUnsafe(GlobalKillStats, gameModel.coreEntity);

        const kills = killStats.kills[trigger.enemyType] || 0;
        const prevKills = killStats.previousStats.kills[trigger.enemyType] || 0;

        if (kills >= trigger.killCount && prevKills < trigger.killCount) {
          const killsToTrigger = trigger.killCount - prevKills;
          if (trigger.enemyType === EnemyTypeEnum.ALL) {
            killFrame = killStats.killsThisFrame?.[killsToTrigger - 1];
          } else {
            killFrame = killStats.killsThisFrame?.filter((kill) => kill.type === trigger.enemyType)[killsToTrigger - 1];
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
            gameModel.getSystem(TriggerEventSystem).run(gameModel, entity);
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
