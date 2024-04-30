import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class Attached extends Schema {
  @type(["number"])
  @defaultValue([])
  children: number[];
}
