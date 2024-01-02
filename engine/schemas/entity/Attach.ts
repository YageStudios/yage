import { Vector2d, Vector2dSchema } from "@/utils/vector";
import { Component, defaultValue, nullable, Schema, type } from "../../decorators/type";

@Component("Attach")
export class AttachSchema extends Schema {
  @type("Entity")
  @nullable()
  parent: number | null;

  @type("boolean")
  @defaultValue(true)
  post: boolean;

  @type("boolean")
  @defaultValue(true)
  direction: boolean;

  @type(Vector2dSchema)
  offset: Vector2d;
}
