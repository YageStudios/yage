import { Component, Schema, type, defaultValue } from "minecs";

@Component("ShareOnEject")
export class ShareOnEject extends Schema {
  @type("EntityArray")
  @defaultValue([])
  entities: number[];

  @type("Entity")
  @defaultValue(-1)
  owner: number;
}
