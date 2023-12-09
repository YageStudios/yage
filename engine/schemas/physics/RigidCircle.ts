import { Component, defaultValue, Schema, type } from "@/decorators/type";
import { CollisionCategoryEnum } from "@/constants/enums";

@Component("RigidCircle")
export class RigidCircleSchema extends Schema {
  @type("number")
  @defaultValue(0)
  radius: number;

  @type("number")
  bodyId: number;

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

@Component("RigidCircleResolver")
export class RigidCircleResolverSchema extends Schema {}
