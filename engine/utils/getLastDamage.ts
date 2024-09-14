import { cloneDeep } from "lodash";
import type { GameModel } from "yage/game/GameModel";
import type { Damage } from "../schemas/damage/DamageStats";
import { Damageable } from "yage/schemas/damage/DamageStats";

export const getLastDamage = (health: number, entityId: number, gameModel: GameModel, suppressErrors = true) => {
  const damages = cloneDeep(gameModel.getTypedUnsafe(Damageable, entityId).damages as Damage[]);

  let traceHealth = health;
  let lastDamage;
  do {
    lastDamage = damages.pop();
    traceHealth += lastDamage?.damage || 0;
  } while (traceHealth <= 0 && damages.length);
  if (traceHealth <= 0 && !suppressErrors) {
    console.log(gameModel.getTypedUnsafe(Damageable, entityId).damages as Damage[]);
    throw new Error("Issue with health");
  }

  return lastDamage;
};
