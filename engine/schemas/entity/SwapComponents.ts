import { Component, defaultValue, Schema, type } from "@/decorators/type";
import type { ComponentData } from "@/components/types";
import { ComponentDataSchema } from "@/components/types";

@Component("SwapComponents")
export class SwapComponentsSchema extends Schema {
  @type(["string"])
  swapComponents: string[] = [];

  @type([ComponentDataSchema])
  swapData: ComponentData[] = [];

  @type("boolean")
  @defaultValue(false)
  swapped: boolean;
}
