import { Component, Schema, type } from "minecs";
import type { KeyMap } from "yage/inputs/InputManager";
import { Vector2d } from "yage/utils/vector";

@Component()
export class PlayerInput extends Schema {
  @type("object")
  keyMap: KeyMap;

  @type(Vector2d)
  mousePosition: Vector2d;

  @type("number")
  buttons: number;

  @type("object")
  prevKeyMap: KeyMap;

  @type("string")
  pid: string;

  @type("string")
  name: string;

  @type(["string"])
  events: string[];
}
