import { Component, Schema, defaultValue, type } from "minecs";

@Component("ShareOnDeath")
export class ShareOnDeath extends Schema {
  @type("EntityArray")
  @defaultValue([])
  entities: number[];

  @type("Entity")
  @defaultValue(-1)
  owner: number;

  @type("Entity")
  @defaultValue(-1)
  killedEntity: number;

  @type("Entity")
  @defaultValue(-1)
  killSource: number;
}
