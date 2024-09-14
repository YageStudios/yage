import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class Portal extends Schema {
  @type("string")
  @defaultValue("")
  fromSave: string;

  @type("boolean")
  @defaultValue(false)
  removeSave: boolean;

  @type("number")
  @defaultValue(0)
  mapId: number;

  @type("string")
  @defaultValue("")
  map: string;

  @type("string")
  @defaultValue("")
  spawnPoint: string;

  @type("number")
  @defaultValue(0)
  x: number;

  @type("number")
  @defaultValue(0)
  y: number;
}
