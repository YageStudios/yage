import { Component, defaultValue, Schema, type } from "@/decorators/type";

@Component("MapSprite")
export class MapSpriteSchema extends Schema {
  @type("string")
  name: string;

  @type("boolean")
  flipHorizontal: boolean;

  @type("boolean")
  flipVertical: boolean;

  @type("boolean")
  @defaultValue(true)
  visible: boolean;

  @type("number")
  @defaultValue(1)
  opacity: number;
}
