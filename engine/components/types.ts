import { ComponentCategory } from "@/constants/enums";
import { required, Schema, type } from "@/decorators/type";

export { ComponentCategory };

export type ComponentData = {
  type: string;
  [key: string]: any;
};

export class ComponentDataSchema extends Schema {
  @required()
  @type("string")
  type: string;

  @type("object")
  data: any;

  @type("boolean")
  inherit?: boolean;
}
