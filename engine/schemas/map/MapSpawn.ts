import { Component, defaultValue, nullable, Schema, type } from "minecs";

@Component()
export class MapSpawn extends Schema {
  @type("string")
  @defaultValue("")
  location: string;

  @type("number")
  @defaultValue(0)
  spawnX: number;

  @type("number")
  @defaultValue(0)
  spawnY: number;

  @type("string")
  map: string;

  @type("Entity")
  @defaultValue(-1)
  mapId: number;

  @type("boolean")
  @defaultValue(true)
  unmountPreviousMap: boolean;
}

@Component()
export class MapId extends Schema {
  @type("Entity")
  @defaultValue(-1)
  @nullable()
  mapId: number | null;

  @type("string")
  @defaultValue("")
  map: string;
}
