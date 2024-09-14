import { Component, defaultValue, Schema, type } from "minecs";
import { ComponentCategory } from "yage/constants/enums";

@Component(ComponentCategory.CORE)
export class EntityCamera extends Schema {
  @type("Entity")
  @defaultValue(-1)
  entity: number;

  @type("number")
  @defaultValue(1)
  zoom: number;
}
