import { FaceDirectionEnum } from "yage/constants/enums";
import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class PixiSprite extends Schema {
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

  @type("boolean")
  @defaultValue(true)
  inheritParentZIndex: boolean;

  @type("boolean")
  @defaultValue(true)
  relativeZIndex: boolean;

  @type("number")
  @defaultValue(1)
  opacity: number;

  @type("number")
  @defaultValue(0.5)
  anchorX: number;

  @type("number")
  @defaultValue(0.5)
  anchorY: number;

  @type("number")
  @defaultValue(0)
  antiJitterTime: number;
}
