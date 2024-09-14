import { Vector2d } from "yage/utils/vector";
import { Component, defaultValue, nullable, Schema, type } from "minecs";

@Component()
export class Child extends Schema {
  @type("number")
  @nullable()
  parent: number | null;

  @type("boolean")
  @defaultValue(true)
  autoAttach: boolean;

  @type("boolean")
  @defaultValue(true)
  post: boolean;

  @type("boolean")
  @defaultValue(true)
  direction: boolean;

  @type(Vector2d)
  offset: Vector2d;
}
