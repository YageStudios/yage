import { Component, defaultValue, Schema, type } from "@/decorators/type";
import type { Vector2d } from "@/utils/vector";
import { Vector2dSchema } from "@/utils/vector";

@Component("RigidPolygon")
export class RigidPolygonSchema extends Schema {
  @type("number")
  bodyId: number;

  @type([Vector2dSchema])
  vertices: Vector2d[];

  @type([Vector2dSchema])
  vertexOffsets: Vector2d[];

  @type(["number"])
  @defaultValue([])
  vertexIndicies: number[];

  @type("number")
  @defaultValue(0)
  width: number;

  @type("number")
  @defaultValue(0)
  height: number;
}
