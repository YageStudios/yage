import { Component, Schema, type } from "@/decorators/type";
import type { KeyMap } from "@/inputs/InputManager";
import type { Vector2d } from "@/utils/vector";
import { Vector2dSchema } from "@/utils/vector";

@Component("PlayerInput")
export class PlayerInputSchema extends Schema {
  @type("object")
  keyMap: KeyMap;

  @type(Vector2dSchema)
  mousePosition: Vector2d;

  @type("number")
  buttons: number;

  @type("object")
  prevKeyMap: KeyMap;

  @type("string")
  id: string;

  @type("string")
  name: string;

  @type(["string"])
  events: string[];
}
