import { Component, Schema, defaultValue, nullable, type } from "minecs";

@Component("NullTest")
export class NullTest extends Schema {
  @type("number")
  @nullable()
  @defaultValue(5)
  nullCheck: number;
}
