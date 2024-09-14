import { Component, type, defaultValue, Schema } from "minecs";
import type { GameTrigger } from "yage/loader/MapLoader";

@Component()
export class Map extends Schema {
  @type("string")
  map: string;

  @type("string")
  skin: string;

  @type(["string"])
  @defaultValue([])
  tiles: string[];

  @type(["number"])
  @defaultValue([])
  tileOffsets: number[];

  @type("number")
  @defaultValue(1)
  scale: number;

  @type("number")
  width: number;

  @type("number")
  height: number;

  @type("boolean")
  shouldUpdatePath: boolean;
}

@Component("MapIsometric")
export class MapIsometric extends Schema {}


export type SBGameTrigger = GameTrigger & {
  type:
    | "ENTITY"
    | "SPAWN"
    | "UNKNOWN"
    | "TELEPORT"
    | "MOVE"
    | "SWAPONCOMPONENTS"
    | "SWAPOFFCOMPONENTS"
    | "CAMERABOUNDARY"
    | "MAPENTITY";
  condition: {
    type: "KILLSTATS" | "GLOBALKILLSTATS" | "NONE" | "ATLOCATION" | "ATLOCATIONWITHITEM" | "TIME";
    subType: "ALLPLAYERS" | "NONE";
    location: { x: number; y: number };
    locationType: "PLAYER" | "FRAME" | "TRIGGER";
    key: any;
    value: any;
    destroyOnTrigger: boolean;
  };
};
