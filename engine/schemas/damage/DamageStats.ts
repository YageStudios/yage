import type { ComponentData } from "yage/components/types";
import { ComponentDataSchema } from "yage/components/types";
import type { DamageTypeEnum } from "yage/constants/enums";
import { DamageCategoryEnum } from "yage/constants/enums";
import { Schema, type, required, Component, defaultValue } from "minecs";
import { Vector2d } from "yage/utils/vector";

@Component("DamageStats")
export class DamageStats extends Schema {
  @type("object")
  initialDamageStats: DamageStats;

  @type("boolean")
  @defaultValue(true)
  invalidated: boolean;

  @type("boolean")
  @defaultValue(false)
  inheritFromOwner: boolean;

  @type("boolean")
  @defaultValue(false)
  inheritFromParent: boolean;

  @type("number")
  @defaultValue(0)
  minDamage: number;

  @type("number")
  @defaultValue(0)
  maxDamage: number;

  @type("number")
  @defaultValue(0)
  minRangedDamage: number;

  @type("number")
  @defaultValue(0)
  maxRangedDamage: number;

  @type("number")
  @defaultValue(0)
  rangedDamageScale: number;

  @type("number")
  @defaultValue(0)
  minMeleeDamage: number;

  @type("number")
  @defaultValue(0)
  maxMeleeDamage: number;

  @type("number")
  @defaultValue(0)
  meleeDamageScale: number;

  @type("number")
  @defaultValue(0)
  minAoeDamage: number;

  @type("number")
  @defaultValue(0)
  maxAoeDamage: number;

  @type("number")
  @defaultValue(0)
  aoeDamageScale: number;

  @type("number")
  @defaultValue(0)
  damageScale: number;

  @type("number")
  @defaultValue(0)
  attackSpeed: number;

  @type("number")
  @defaultValue(0)
  attackSpeedScale: number;

  @type("number")
  @defaultValue(0)
  critChance: number;

  @type("number")
  @defaultValue(0)
  critScale: number;

  @type("number")
  @defaultValue(0)
  knockbackChance: number;

  @type("number")
  @defaultValue(0)
  knockback: number;

  @type("number")
  @defaultValue(0)
  minElementalDamage: number;

  @type("number")
  @defaultValue(0)
  maxElementalDamage: number;

  @type("number")
  @defaultValue(0)
  elementalDamageScale: number;

  @type("number")
  @defaultValue(0)
  burnChance: number;

  @type("number")
  @defaultValue(0)
  minFireDamage: number;

  @type("number")
  @defaultValue(0)
  maxFireDamage: number;

  @type("number")
  @defaultValue(0)
  burnDamageScale: number;

  @type("number")
  @defaultValue(0)
  burnDuration: number;

  @type("number")
  @defaultValue(0)
  minColdDamage: number;

  @type("number")
  @defaultValue(0)
  maxColdDamage: number;

  @type("number")
  @defaultValue(0)
  freezeChance: number;

  @type("number")
  @defaultValue(0)
  freezeDuration: number;

  @type("number")
  @defaultValue(0)
  poisonChance: number;

  @type("number")
  @defaultValue(0)
  minChaosDamage: number;

  @type("number")
  @defaultValue(0)
  maxChaosDamage: number;

  @type("number")
  @defaultValue(0)
  poisonDuration: number;

  @type("number")
  @defaultValue(0.5)
  poisonInterval: number;

  @type("number")
  @defaultValue(0)
  stunChance: number;

  @type("number")
  @defaultValue(0)
  stunDuration: number;

  @type("number")
  @defaultValue(0)
  bleedChance: number;

  @type("number")
  @defaultValue(0)
  bleedDamage: number;

  @type("number")
  @defaultValue(0)
  bleedDuration: number;

  @type("number")
  @defaultValue(0)
  bleedInterval: number;

  @type("number")
  @defaultValue(0)
  slowChance: number;

  @type("number")
  @defaultValue(0)
  slowDuration: number;

  @type("number")
  @defaultValue(0)
  slowAmount: number;

  @type("number")
  @defaultValue(0)
  minLightningDamage: number;

  @type("number")
  @defaultValue(0)
  maxLightningDamage: number;

  @type("number")
  @defaultValue(0)
  shockChance: number;

  @type("number")
  @defaultValue(0)
  shockMultiplier: number;

  @type("number")
  @defaultValue(0)
  areaOfEffect: number;

  @type("number")
  @defaultValue(0)
  range: number;

  @type("number")
  @defaultValue(0)
  chance: number;

  @type("number")
  @defaultValue(0)
  minAllyDamage: number;

  @type("number")
  @defaultValue(0)
  maxAllyDamage: number;

  @type("number")
  @defaultValue(0)
  allyDamageScale: number;

  @type("number")
  @defaultValue(0)
  pierceScale: number;
}

@Component("Damage")
export class Damage extends Schema {
  @type(DamageStats)
  @required()
  damageStats: DamageStats;

  @type("Entity")
  @required()
  owner: number;

  @type("number")
  damage: number;

  @type(DamageCategoryEnum)
  damageCategory: DamageCategoryEnum;

  @type("Entity")
  @required()
  source: number;

  @type("number")
  @required()
  frame: number;

  @type("number")
  @required()
  damageType: DamageTypeEnum;

  @type(Vector2d)
  direction: Vector2d;

  @type("number")
  knockback: number;

  @type("number")
  critChance: number;

  @type("boolean")
  critHit: boolean;

  @type("number")
  damageScale: number;

  @type("string")
  soundKey?: string;

  @type([ComponentDataSchema])
  onHit?: ComponentData[];
}

@Component("Damageable")
export class Damageable extends Schema {
  @type([Damage])
  @defaultValue([])
  damages: Damage[];

  @type("number")
  @defaultValue(0)
  lastDamageTick: number;

  @type("number")
  @defaultValue(100)
  invulnerabilityMs: number;

  @type("number")
  @defaultValue(0)
  radius: number;

  @type("number")
  @defaultValue(1)
  damageScale: number;

  @type(Damage)
  currentDamage: Damage;
}
