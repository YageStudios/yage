import type { ComponentData } from "yage/systems/types";
import { ComponentDataSchema } from "yage/systems/types";
import { Component, defaultValue, Schema, type } from "minecs";
import { Vector2d } from "yage/utils/vector";

@Component("TriggerEvent")
export class TriggerEvent extends Schema {
  @type(Vector2d)
  location: Vector2d;

  @type("number")
  @defaultValue(0)
  width: number;

  @type("number")
  @defaultValue(0)
  height: number;

  @type("number")
  @defaultValue(0)
  count: number;

  @type("string")
  event:
    | "ENTITY"
    | "MAPENTITY"
    | "SPAWN"
    | "UNKNOWN"
    | "TELEPORT"
    | "MOVE"
    | "SWAPONCOMPONENTS"
    | "SWAPOFFCOMPONENTS"
    | "CAMERABOUNDARY";

  @type("string")
  name: string;

  @type("object")
  overrideProperties: any;

  @type([ComponentDataSchema])
  @defaultValue([])
  components: ComponentData[];

  @type(["number"])
  @defaultValue([])
  triggerEntities: number[];
}
