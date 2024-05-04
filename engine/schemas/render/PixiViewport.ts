import { Component, Schema, defaultValue, type } from "minecs";

@Component()
export class PixiViewport extends Schema {
  // @type("string")
  // @required()
  // elementId: string;

  @type("number")
  @defaultValue(1089)
  minWidth: number;

  @type("number")
  @defaultValue(1080)
  minHeight: number;

  @type("boolean")
  @defaultValue(false)
  fillScreen: boolean;
}
