import { Component, Schema, type } from "@/decorators/type";

@Component("Events")
export class EventsSchema extends Schema {
  @type(["string"])
  events: string[];
}
