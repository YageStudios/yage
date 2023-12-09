import { Component, defaultValue, Schema, type } from "@/decorators/type";
import { Vector2dSchema } from "@/utils/vector";
import { CollisionCategoryEnum } from "@/constants/enums";

@Component("RigidBox")
export class RigidBoxSchema extends Schema {
  @type("number")
  width: number;

  @type("number")
  height: number;

  @type("number")
  bodyId: number;

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

  @type(Vector2dSchema)
  @defaultValue({ x: 0, y: 0 })
  point: Vector2dSchema;

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

@Component("RigidBoxResolver")
export class RigidBoxResolverSchema extends Schema {
  @type("number")
  bodyId: number;
}
