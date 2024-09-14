import { Component, Schema, defaultValue, required, type } from "minecs";

class PixiGraphicCircle extends Schema {
  @type("number")
  @required()
  x: number;

  @type("number")
  @required()
  y: number;

  @type("number")
  @required()
  radius: number;
}

class PixiGraphicEllipse extends Schema {
  @type("number")
  @required()
  x: number;

  @type("number")
  @required()
  y: number;

  @type("number")
  @required()
  width: number;

  @type("number")
  @required()
  height: number;
}

class PixiGraphicRectangle extends Schema {
  @type("number")
  @required()
  x: number;

  @type("number")
  @required()
  y: number;

  @type("number")
  @required()
  width: number;

  @type("number")
  @required()
  height: number;
}

@Component()
export class PixiGraphic extends Schema {
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

  @type("string")
  fillColor: string;

  @type("string")
  strokeColor: string;

  @type("number")
  lineWidth: number;

  @type(PixiGraphicCircle)
  circle: PixiGraphicCircle;

  @type(PixiGraphicEllipse)
  ellipse: PixiGraphicEllipse;

  @type(PixiGraphicRectangle)
  rectangle: PixiGraphicRectangle;

  @type(["number"])
  polygon: number[];
}
