import { Component, Schema, defaultValue, type } from "minecs";

@Component("ShareOnKill")
export class ShareOnKill extends Schema {
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
