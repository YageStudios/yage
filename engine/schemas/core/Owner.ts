import { Component, nullable, Schema, type } from "minecs";

@Component()
export class Owner extends Schema {
  @type("Entity")
  @nullable()
  owner: number | null;
}
