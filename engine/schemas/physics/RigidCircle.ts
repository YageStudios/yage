import { Component, defaultValue, Schema, type } from "minecs";
import { CollisionCategoryEnum } from "yage/constants/enums";

@Component()
export class RigidCircle extends Schema {
  @type("number")
  @defaultValue(0)
  radius: number;

  @type("boolean")
  @defaultValue(false)
  isStatic: boolean;

  @type("boolean")
  @defaultValue(false)
  isSensor: boolean;

  @type("number")
  @defaultValue(1)
  mass: number;

  @type("boolean")
  @defaultValue(false)
  disabled: boolean;

  @type("boolean")
  @defaultValue(false)
  directionLock: boolean;

  @type("boolean")
  @defaultValue(false)
  velocityLock: boolean;

  @type(CollisionCategoryEnum)
  @defaultValue(CollisionCategoryEnum.DEFAULT)
  collisionCategory: CollisionCategoryEnum;

  @type("boolean")
  @defaultValue(false)
  collisionEvents: boolean;

  @type(["number"])
  collisionMask: CollisionCategoryEnum[];
}

@Component()
export class RigidCircleResolver extends Schema {}
