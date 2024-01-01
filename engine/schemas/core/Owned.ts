import { Component, defaultValue, nullable, Schema, type } from "@/decorators/type";

@Component("Owned")
export class OwnedSchema extends Schema {
  @type(["number"])
  @defaultValue([])
  owned: number[];
}
