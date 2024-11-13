import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class Attached extends Schema {
  @type("EntityArray")
  @defaultValue([])
  children: number[];
}
