import { Component, Schema, defaultValue, type } from "minecs";

@Component("NullTest")
export class NullTest extends Schema {
  @type("number")
  @defaultValue(5)
  nullCheck: number;
}
