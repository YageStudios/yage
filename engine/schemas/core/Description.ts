import { type, Schema, Component, defaultValue } from "minecs";

@Component()
export default class Description extends Schema {
  @type("string")
  @defaultValue("")
  description: string;
}
