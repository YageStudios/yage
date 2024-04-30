import { Component, defaultValue, required, Schema, type } from "minecs";
import { EnemyTypeEnum } from "yage/constants/enums";
import { Vector2d } from "yage/utils/vector";

class KillStat extends Schema {
  @type("number")
  @defaultValue(0)
  [EnemyTypeEnum.U_DEF]: number;

  @type("number")
  @defaultValue(0)
  [EnemyTypeEnum.ALL]: number;

  @type("number")
  @defaultValue(0)
  [EnemyTypeEnum.DEMON]: number;

  @type("number")
  [EnemyTypeEnum.SLUDGE]: number;

  @type("number")
  [EnemyTypeEnum.NECROMANCER]: number;

  @type("number")
  [EnemyTypeEnum.ORC]: number;

  @type("number")
  [EnemyTypeEnum.ZOMBIE]: number;
}

@Component("KillFrame")
export class KillFrame extends Schema {
  @required()
  @type("number")
  type: EnemyTypeEnum;

  @type("string")
  @defaultValue("")
  description: string;

  @required()
  @type(Vector2d)
  position: Vector2d;

  @required()
  @type("Entity")
  owner: number;

  @type("Entity")
  source: number;
}

@Component("PreviousKills")
export class PreviousKills extends Schema {
  @type(KillStat)
  @defaultValue({})
  kills: KillStat;

  @type([KillFrame])
  @defaultValue([])
  killsThisFrame: Array<KillFrame>;
}

@Component("KillStats")
export class KillStats extends Schema {
  @type(KillStat)
  @defaultValue({})
  kills: KillStat;

  @type([KillFrame])
  @defaultValue([])
  killsThisFrame: Array<KillFrame>;

  @type(PreviousKills)
  @defaultValue({})
  previousStats: PreviousKills;
}

@Component("GlobalKillStats")
export class GlobalKillStats extends KillStats {}
