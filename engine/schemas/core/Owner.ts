import { Component, nullable, Schema, type } from "minecs";

@Component()
export class Owner extends Schema {
  @type("number")
  @nullable()
  owner: number | null;
}
