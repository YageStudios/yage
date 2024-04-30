import { ComponentCategory, ComponentDataSchema } from "yage/components/types";
import { Component, defaultValue, required, Schema, type } from "minecs";

@Component(ComponentCategory.CORE)
export class Spawn extends Schema {
  @type("string")
  @required()
  description: string;

  @type([ComponentDataSchema])
  @defaultValue([])
  overrideComponents: ComponentDataSchema[];
}
