import { Component, Schema, type } from "minecs";

@Component()
export class Random extends Schema {
  @type("number")
  random: number;

  @type("string")
  seed: string;

  @type("number")
  seedNumber: number;
}
