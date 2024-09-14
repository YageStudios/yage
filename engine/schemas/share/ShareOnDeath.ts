import { Component, Schema, defaultValue, type } from "minecs";

@Component("ShareOnDeath")
export class ShareOnDeath extends Schema {
  @type(["number"])
  @defaultValue([])
  entities: number[];

  @type("number")
  @defaultValue(-1)
  owner: number;

  @type("number")
  @defaultValue(-1)
  killedEntity: number;

  @type("number")
  @defaultValue(-1)
  killSource: number;
}
