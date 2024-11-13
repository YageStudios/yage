import { Component, Schema, defaultValue, type } from "minecs";

@Component("ShareOnHeal")
export class ShareOnHeal extends Schema {
  @type("EntityArray")
  @defaultValue([])
  entities: number[];

  @type("Entity")
  @defaultValue(-1)
  owner: number;
}
