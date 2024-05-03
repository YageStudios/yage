import { EnemyTypeEnum } from "yage/constants/enums";
import { Component, defaultValue, Schema, type } from "minecs";
import { Vector2d } from "yage/utils/vector";

@Component()
export class GlobalKillStatsTrigger extends Schema {
  @type(EnemyTypeEnum)
  enemyType: EnemyTypeEnum;

  @type("number")
  killCount: number;

  @type("string")
  locationType: "PLAYER" | "FRAME" | "TRIGGER";

  @type(Vector2d)
  location: Vector2d;

  @type("boolean")
  @defaultValue(false)
  destroyOnTrigger: boolean;

  @type("number")
  @defaultValue(0)
  triggerCount: number;

  @type("string")
  @defaultValue("NONE")
  triggerType: "NONE" | "ALLPLAYERS";

  @type("boolean")
  @defaultValue(false)
  disableOnHidden: boolean;
}
