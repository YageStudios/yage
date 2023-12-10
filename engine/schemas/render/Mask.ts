import { Component, Schema, defaultValue, type } from "@/decorators/type";
import { registerSchema } from "@/components/ComponentRegistry";

@Component("Mask")
export class MaskSchema extends Schema {
  @type("string")
  @defaultValue("Sprite")
  pixiComponent: string;

  @type("string")
  maskKey: string;

  @type("number")
  @defaultValue(0.5)
  anchorX: number;

  @type("number")
  @defaultValue(0.5)
  anchorY: number;

  @type("number")
  @defaultValue(0)
  width: number;

  @type("number")
  @defaultValue(0)
  height: number;
}

registerSchema(MaskSchema);
