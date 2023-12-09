import { Bitecs, BitecsSchema, Component, defaultValue, Schema, type } from "@/decorators/type";

@Component("FrameRate")
export class FrameRateSchema extends Schema {
  @type("number")
  @defaultValue(0)
  startFrameStamp: number;

  @type("number")
  @defaultValue(0)
  frameRate: number;

  @type("number")
  @defaultValue(0)
  stopFrameStamp: number;

  @type("number")
  @defaultValue(60)
  averageFrameRate: number;

  @type("number")
  @defaultValue(0)
  bodies: number;
}

@Bitecs()
@Component("Frame")
export class FrameSchema extends BitecsSchema {
  @type("uint32")
  @defaultValue(0)
  frame: number;
}

@Component("FrameEnd")
export class FrameEndSchema extends Schema {}
