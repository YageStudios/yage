import { type, Schema, Component, defaultValue } from "@/decorators/type";

@Component("Description")
export default class DescriptionSchema extends Schema {
  @type("string")
  @defaultValue("")
  description: string;
}
