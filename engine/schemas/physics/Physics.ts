import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class Physics extends Schema {
  @type("number")
  @defaultValue(0)
  gravityX: number;

  @type("number")
  @defaultValue(0)
  gravityY: number;
}
