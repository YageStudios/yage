import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class Owned extends Schema {
  @type(["number"])
  @defaultValue([])
  owned: number[];
}
