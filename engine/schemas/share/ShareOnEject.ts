import { Component, Schema, type, defaultValue } from "minecs";

@Component("ShareOnEject")
export class ShareOnEject extends Schema {
  @type(["number"])
  @defaultValue([])
  entities: number[];

  @type("number")
  @defaultValue(-1)
  owner: number;
}
