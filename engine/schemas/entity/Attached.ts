import { Component, defaultValue, Schema, type } from "@/decorators/type";

@Component("Attached")
export class AttachedSchema extends Schema {
  @type("EntityArray")
  @defaultValue([])
  children: Array<number>;
}
