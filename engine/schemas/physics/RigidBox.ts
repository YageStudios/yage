import { Component, defaultValue, Schema, type } from "minecs";
import { Vector2d } from "yage/utils/vector";
import { CollisionCategoryEnum } from "yage/constants/enums";

@Component()
export class RigidBox extends Schema {
  @type("number")
  width: number;

  @type("number")
  height: number;

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
export class RigidBoxResolver extends Schema {}
