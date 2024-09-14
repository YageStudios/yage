import { Component, defaultValue, Schema, type } from "minecs";
import { TriggerEvent } from "yage/schemas/triggers/TriggerEvent";

@Component()
export class BaseTrigger extends Schema {
  @type("string")
  @defaultValue("NONE")
  triggerType: "NONE" | "ALLPLAYERS";

  @type([TriggerEvent])
  @defaultValue([])
  triggerEvent: TriggerEvent[];

  @type("boolean")
  @defaultValue(false)
  triggerSourceEntity: boolean;

  @type("boolean")
  @defaultValue(false)
  disableOnHidden: boolean;

  @type("boolean")
  @defaultValue(false)
  destroyOnTrigger: boolean;

  @type("boolean")
  @defaultValue(false)
  inheritLocation: boolean;
}
