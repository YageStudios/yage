import { Component, type, defaultValue, Schema } from "minecs";

@Component()
export class ListenEntityCreation extends Schema {
  @type("EntityArray")
  @defaultValue([])
  entities: number[];

  @type("Entity")
  @defaultValue(-1)
  entity: number;
}
