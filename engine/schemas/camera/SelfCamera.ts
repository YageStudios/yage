import { Component, defaultValue, Schema, type } from "minecs";
import { ComponentCategory } from "yage/constants/enums";

@Component(ComponentCategory.CORE)
export class SelfCamera extends Schema {
  @type("number")
  @defaultValue(1)
  zoom: number;
}
