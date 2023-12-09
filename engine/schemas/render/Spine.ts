import { FaceDirectionEnum } from "../../constants/enums";
import { Component, defaultValue, Schema, type } from "../../decorators/type";

@Component("Spine")
export class SpineSchema extends Schema {
  @type("number")
  @defaultValue(0)
  frame: number;

  @type("string")
  spineKey: string;

  @type("string")
  skin: string;

  @type("string")
  currentAnimation: string;

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
  xscale: number;

  @type("number")
  yscale: number;

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
}
