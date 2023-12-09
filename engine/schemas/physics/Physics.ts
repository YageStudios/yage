import { Component, defaultValue, Schema, type } from "@/decorators/type";

@Component("Physics")
export class PhysicsSchema extends Schema {
  @type("number")
  @defaultValue(0)
  gravityX: number;

  @type("number")
  @defaultValue(1)
  gravityY: number;
}
