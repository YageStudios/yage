import { DEPTHS, registerSystem } from "yage/components/ComponentRegistry";
import type { System } from "yage/components/System";
import { ComponentCategory } from "yage/components/types";
import { EnemyTypeEnum } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { TransformSchema } from "yage/schemas/entity/Transform";
import { TriggerEventSystem } from "./TriggerEvent";
import { MapSpriteSchema } from "yage/schemas/render/MapSprite";
import { SpriteSchema } from "yage/schemas/render/Sprite";
import type { KillFrameSchema, KillStatsSchema } from "yage/schemas/player/KillStats";
import { GlobalKillStatsTriggerSchema } from "yage/schemas/triggers/GlobalKillStatsTrigger";
import { TriggerEventSchema } from "yage/schemas/triggers/TriggerEvent";
import { WorldSchema } from "yage/schemas/core/World";

export class GlobalKillStatsTriggerSystem implements System {
  type = "GlobalKillStatsTrigger";
  category: ComponentCategory = ComponentCategory.TRIGGER;
  schema = GlobalKillStatsTriggerSchema;
  depth = DEPTHS.HEALTH + 2;
  dependencies?: string[] | undefined;

  runAll(gameModel: GameModel): void {
    const entities = gameModel.getComponentActives(this.type);
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      gameModel.currentWorld = WorldSchema.store.world[entity];

      const trigger = gameModel.getComponent(entity, this.type) as GlobalKillStatsTriggerSchema;

      if (trigger.disableOnHidden) {
        let sprite; //gameModel.getTyped(entity, SpriteSchema);
        if (gameModel.hasComponent(entity, "Sprite")) {
          sprite = gameModel.getTyped(entity, SpriteSchema);
        } else if (gameModel.hasComponent(entity, "MapSprite")) {
          sprite = gameModel.getTyped(entity, MapSpriteSchema);
        } else {
          continue;
        }
        if (sprite?.opacity === 0) continue;
      }

      for (let j = 0; j < gameModel.players.length; j++) {
        const playerId = gameModel.players[j];

        let killFrame: KillFrameSchema | null = null;
        const killStats = gameModel.getComponent(gameModel.coreEntity, "GlobalKillStats") as KillStatsSchema;

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
                location = { x: TransformSchema.store.x[playerId], y: TransformSchema.store.y[playerId] };
                break;
              case "FRAME":
                location = killFrame.position;
                break;
            }
            const triggerEvent = gameModel.getTypedUnsafe(entity, TriggerEventSchema);
            triggerEvent.location = location;
            gameModel.getSystem(TriggerEventSystem).run(entity, gameModel);
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

registerSystem(GlobalKillStatsTriggerSystem);
