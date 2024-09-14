import { Component, defaultValue, Schema, type } from "minecs";
import type { ComponentData } from "yage/systems/types";
import { ComponentDataSchema } from "yage/systems/types";

@Component()
export class SwapComponents extends Schema {
  @type(["string"])
  swapComponents: string[] = [];

  @type([ComponentDataSchema])
  swapData: ComponentData[] = [];

  @type("boolean")
  @defaultValue(false)
  swapped: boolean;
}
