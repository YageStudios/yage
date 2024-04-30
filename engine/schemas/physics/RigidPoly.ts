import { CollisionCategoryEnum } from "yage/constants/enums";
import { Component, defaultValue, Schema, type } from "minecs";
import { Vector2d } from "yage/utils/vector";

class Shape extends Schema {
  @type([Vector2d])
  points: Vector2d[];
}

@Component()
export class RigidPoly extends Schema {
  @type([Shape])
  shapes: Shape[];

  @type("boolean")
  @defaultValue(false)
  isStatic: boolean;

  @type("boolean")
  @defaultValue(false)
  isSensor: boolean;

  @type("number")
  @defaultValue(0)
  restitution: number;

  @type("number")
  @defaultValue(0)
  mass: number;

  @type("number")
  @defaultValue(0)
  angle: number;

  @type("boolean")
  @defaultValue(false)
  disabled: boolean;

  @type(Vector2d)
  @defaultValue({ x: 0, y: 0 })
  point: Vector2d;

  @type("boolean")
  @defaultValue(false)
  velocityLock: boolean;

  @type("boolean")
  @defaultValue(false)
  directionLock: boolean;

  @type(CollisionCategoryEnum)
  @defaultValue(CollisionCategoryEnum.DEFAULT)
  collisionCategory: CollisionCategoryEnum;

  @type(["number"])
  collisionMask: CollisionCategoryEnum[];

  @type("boolean")
  @defaultValue(false)
  collisionEvents: boolean;
}

@Component()
export class RigidPolyResolver extends Schema {
  @type("number")
  bodyId: number;
}
