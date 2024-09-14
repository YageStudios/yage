import { Component, Schema, defaultValue, type } from "minecs";

@Component()
export class World extends Schema {
  @type("int32")
  @defaultValue(0)
  world: number;

  @type("string")
  @defaultValue("")
  worldName: string;
}
