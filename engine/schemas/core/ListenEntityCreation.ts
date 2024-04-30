import { Component, type, defaultValue, Schema } from "minecs";

@Component()
export class ListenEntityCreation extends Schema {
  @type(["number"])
  @defaultValue([])
  entities: number[];

  @type("number")
  @defaultValue(-1)
  entity: number;
}
