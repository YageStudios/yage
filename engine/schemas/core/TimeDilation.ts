import { Component, defaultValue, Schema, type } from "@/decorators/type";

@Component("TimeDilation")
export class TimeDilationSchema extends Schema {
  @type("number")
  @defaultValue(0.5)
  amount: number;
}
