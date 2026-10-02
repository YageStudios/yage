import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class FrameRate extends Schema {}

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
