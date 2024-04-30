import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class Parent extends Schema {
  @type(["number"])
  @defaultValue([])
  children: Array<number>;
}
