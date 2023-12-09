import { Component, defaultValue, Schema, type } from "@/decorators/type";

@Component("Parent")
export class ParentSchema extends Schema {
  @type("EntityArray")
  @defaultValue([])
  children: Array<number>;
}
