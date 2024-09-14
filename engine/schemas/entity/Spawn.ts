import type { ComponentData } from "yage/systems/types";
import { ComponentCategory, ComponentDataSchema } from "yage/systems/types";
import { Component, defaultValue, required, Schema, type } from "minecs";

@Component(ComponentCategory.CORE)
export class Spawn extends Schema {
  @type("string")
  @required()
  description: string;

  @type([ComponentDataSchema])
  @defaultValue([])
  overrideComponents: ComponentData[];
}
