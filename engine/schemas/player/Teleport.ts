import { Component, Schema, defaultValue, type } from "minecs";

@Component()
export class Teleport extends Schema {
  @type("string")
  map: string;

  @type("string")
  @defaultValue("")
  spawnPoint: string;

  @type("number")
  @defaultValue(0)
  x: number;

  @type("number")
  @defaultValue(0)
  y: number;
}
