import { Component, defaultValue, type } from "@/decorators/type";
import { SpriteSchema } from "./Sprite";

@Component("ImportantSprite")
export class ImportantSpriteSchema extends SpriteSchema {
  @type("boolean")
  @defaultValue(false)
  hideInView: boolean;

  @type("number")
  @defaultValue(20)
  padding: number;
}
