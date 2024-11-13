import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class Parent extends Schema {
  @type("EntityArray")
  @defaultValue([])
  children: Array<number>;
}
