import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class FrameRate extends Schema {
  @type("string")
  uiMap: string;
  // @type("number")
  // @defaultValue(0)
  // startFrameStamp: number;
  // @type("number")
  // @defaultValue(0)
  // frameRate: number;
  // @type("number")
  // @defaultValue(0)
  // stopFrameStamp: number;
  // @type("number")
  // @defaultValue(60)
  // averageFrameRate: number;
  // @type("number")
  // @defaultValue(0)
  // bodies: number;
}

@Component()
export class Frame extends Schema {
  @type("uint32")
  @defaultValue(0)
  frame: number;
}

@Component()
export class FrameEnd extends Schema {}

@Component()
export class FrameStart extends Schema {}
