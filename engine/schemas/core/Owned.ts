import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class Owned extends Schema {
  @type("EntityArray")
  @defaultValue([])
  owned: number[];
}
