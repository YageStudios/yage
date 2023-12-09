import { registerSchema } from "@/components/ComponentRegistry";
import { ComponentCategory, ComponentDataSchema } from "@/components/types";
import { Component, defaultValue, Schema, type } from "@/decorators/type";

@Component("Spawn")
export class SpawnSchema extends Schema {
  @type("string")
  description: string;

  @type([ComponentDataSchema])
  @defaultValue([])
  overrideComponents: ComponentDataSchema[];
}
registerSchema(ComponentCategory.CORE, SpawnSchema);
