import { Schema, required, type } from "minecs";
import { ComponentCategory } from "yage/constants/enums";

export { ComponentCategory };

export type ComponentData = {
  type: string;
  [key: string]: any;
};

export class ComponentDataSchema<T = any> extends Schema {
  @required()
  @type("string")
  type: string;

  @type("object")
  data: Partial<T>;

  @type("boolean")
  inherit?: boolean;

  [key: string]: any;
}
