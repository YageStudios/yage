import { ComponentCategory, DEPTHS, EnemyTypeEnum } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { Transform } from "yage/schemas/entity/Transform";
import { KillStats } from "yage/schemas/player/KillStats";
import type { Damage } from "yage/schemas/damage/DamageStats";
import type { Vector2d } from "yage/utils/vector";
import { getLastDamage } from "yage/utils/getLastDamage";
import { EnemyType } from "yage/schemas/entity/Types";
import { ShareOnKill } from "yage/schemas/share/ShareOnKill";
import { ShareOnDeath } from "yage/schemas/share/ShareOnDeath";
import { Health } from "yage/schemas/core/Health";
import { World } from "yage/schemas/core/World";
import { System, SystemImpl } from "minecs";

@System(Health)
export class HealthSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.TARGET;
  static depth = DEPTHS.HEALTH;

  init = (gameModel: GameModel, entity: number) => {
    const health = gameModel(Health).store.health[entity];
    const maxHealth = gameModel(Health).store.maxHealth[entity];
    if (!maxHealth) {
      gameModel(Health).store.maxHealth[entity] = health;
    }
  };

  incrementKill(
    enemyType: EnemyTypeEnum,
    lastDamage: Damage,
    killedEntity: number,
    killPosition: Vector2d,
    entity: number,
    gameModel: GameModel
  ) {
    gameModel.runMods(
      [entity, ...(gameModel.getTyped(ShareOnKill, entity)?.entities ?? [])],
      ComponentCategory.ON_KILL,
      {
        owner: lastDamage.owner,
        killedEntity,
        killSource: entity,
      }
    );

    const killStats = gameModel.hasComponent("KillStats", entity)
      ? gameModel.getTypedUnsafe(KillStats, entity)
      : undefined;
    if (killStats) {
      killStats.kills[enemyType] = (killStats.kills[enemyType] || 0) + 1;

      killStats.killsThisFrame.push({
        description: gameModel.getComponent("Description", killedEntity)?.description || "",
        type: enemyType,
        position: {
          x: killPosition.x,
          y: killPosition.y,
        },
        owner: lastDamage.owner,
        source: entity,
      });
      killStats.kills[EnemyTypeEnum.ALL] = (killStats.kills[EnemyTypeEnum.ALL] || 0) + 1;
    }
  }

  runAll = (gameModel: GameModel) => {
    const entities = this.query(gameModel);

    const healthStore = gameModel(Health).store;
    const worldStore = gameModel(World).store;

    const initialWorld = gameModel.currentWorld;
    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      gameModel.currentWorld = worldStore.world[entity];
      const health = healthStore.health[entity];
      const maxHealth = healthStore.maxHealth[entity];

      if (health <= 0) {
        if (gameModel.hasComponent("EnemyType", entity)) {
          const position = gameModel(Transform, entity);
          const enemyType = gameModel.getTypedUnsafe(EnemyType, entity).enemyType;

          const lastDamage = getLastDamage(health, entity, gameModel);
          if (lastDamage?.owner !== undefined) {
            this.incrementKill(enemyType, lastDamage, entity, position, lastDamage.owner, gameModel);
          }
          if (lastDamage?.source) {
            this.incrementKill(enemyType, lastDamage, entity, position, lastDamage.source, gameModel);
          }
        }
        gameModel.runMods(
          [entity, ...(gameModel.getTyped(ShareOnDeath, entity)?.entities ?? [])],
          ComponentCategory.ON_DEATH,
          {
            killedEntity: entity,
          }
        );
        gameModel.removeEntity(entity);
      }
      if (health > maxHealth) {
        healthStore.health[entity] = maxHealth;
      }
    }
    gameModel.currentWorld = initialWorld;
  };
}
