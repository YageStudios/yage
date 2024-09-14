import { Component, Schema, defaultValue, type } from "minecs";

@Component("ShareOnHeal")
export class ShareOnHeal extends Schema {
  @type(["number"])
  @defaultValue([])
  entities: number[];

  @type("number")
  @defaultValue(-1)
  owner: number;
}
