import { registerSchema } from "@/components/ComponentRegistry";
import { ComponentCategory, FaceDirectionEnum } from "../../constants/enums";
import { Component, defaultValue, Schema, type } from "../../decorators/type";

@Component("Sprite")
export class SpriteSchema extends Schema {
  @type("number")
  @defaultValue(0)
  frame: number;

  @type("number")
  @defaultValue(0)
  framePadding: number;

  @type("string")
  spriteKey: string;

  @type("string")
  imageKey: string;

  @type("string")
  currentAnimation: string;

  @type("number")
  @defaultValue(0)
  animationIndex: number;

  @type("string")
  animationKey: string;

  @type("number")
  @defaultValue(0)
  animationSpeed: number;

  @type("number")
  @defaultValue(FaceDirectionEnum.NONE)
  faceDirection: FaceDirectionEnum;

  @type("number")
  @defaultValue(1)
  scale: number;

  @type("number")
  @defaultValue(1)
  initialScale: number;

  @type("number")
  @defaultValue(0)
  rotation: number;

  @type("number")
  @defaultValue(0)
  xoffset: number;

  @type("number")
  @defaultValue(0)
  yoffset: number;

  @type("number")
  @defaultValue(0)
  zIndex: number;

  @type("number")
  @defaultValue(1)
  opacity: number;

  @type("number")
  @defaultValue(0.5)
  anchorX: number;

  @type("number")
  @defaultValue(0.5)
  anchorY: number;

  @type("boolean")
  @defaultValue(0)
  antiJitterTime: number;
}

registerSchema(ComponentCategory.RENDERING, SpriteSchema);
