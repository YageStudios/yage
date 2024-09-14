import { Component, Schema, type } from "minecs";

@Component()
export class Events extends Schema {
  @type(["string"])
  events: string[];
}
