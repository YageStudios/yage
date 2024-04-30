import { Component, defaultValue, Schema, type } from "minecs";
import { ComponentDataSchema } from "yage/components/types";

@Component()
export class SwapComponents extends Schema {
  @type(["string"])
  swapComponents: string[] = [];

  @type([ComponentDataSchema])
  swapData: ComponentDataSchema[] = [];

  @type("boolean")
  @defaultValue(false)
  swapped: boolean;
}
