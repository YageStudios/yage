import { Component, Schema, defaultValue, type } from "minecs";

@Component()
export class Locomotion extends Schema {
  @type("float32")
  @defaultValue(0)
  x: number;

  @type("float32")
  @defaultValue(0)
  y: number;

  @type("float32")
  @defaultValue(6)
  speed: number;

  @type("float32")
  @defaultValue(0)
  directionX: number;

  @type("float32")
  @defaultValue(1)
  directionY: number;

  @type("float32")
  @defaultValue(0)
  decayingVelocityX: number;

  @type("float32")
  @defaultValue(0)
  decayingVelocityY: number;

  @type("float32")
  @defaultValue(0)
  decayingVelocityTime: number;

  @type("float32")
  @defaultValue(1)
  decayingVelocityScale: number;

  @type("uint8")
  @defaultValue(0)
  fixedDirection: number;
}
