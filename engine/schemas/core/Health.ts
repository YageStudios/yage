import { Component, Schema, defaultValue, type } from "minecs";

@Component()
export class Health extends Schema {
  @type("int32")
  @defaultValue(100)
  health: number;

  @type("int32")
  @defaultValue(0)
  maxHealth: number;
}
