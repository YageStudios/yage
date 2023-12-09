import { Component, nullable, Schema, type } from "@/decorators/type";

@Component("Owner")
export class OwnerSchema extends Schema {
  @type("Entity")
  @nullable()
  owner: number | null;
}
