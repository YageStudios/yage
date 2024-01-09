import { ComponentCategory } from "@/constants/enums";
import { required, Schema, type } from "@/decorators/type";

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
}
