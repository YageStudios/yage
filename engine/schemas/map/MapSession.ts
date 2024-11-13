import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class MapSession extends Schema {
  @type(["string"])
  @defaultValue([])
  maps: string[];

  @type("EntityArray")
  @defaultValue([])
  mapIds: number[];

  @type(["number"])
  @defaultValue([])
  mapTimes: number[];
}
