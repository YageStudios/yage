import { Component, defaultValue, type } from "minecs";
import { Vector2d } from "yage/utils/vector";
import { BaseTrigger } from "yage/schemas/triggers/BaseTrigger";
import { ComponentCategory } from "yage/constants/enums";

@Component(ComponentCategory.TRIGGER)
export class AtLocationTrigger extends BaseTrigger {
  @type(Vector2d)
  location: Vector2d;

  @type("number")
  @defaultValue(10)
  radius: number;

  @type("number")
  @defaultValue(0)
  innerRadius: number;

  @type("boolean")
  @defaultValue(false)
  triggerOnUse: boolean;

  @type("string")
  sourceDescription: string;

  @type("boolean")
  @defaultValue(false)
  inclusiveOfSource: boolean;
}
