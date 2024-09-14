import { Component, defaultValue, Schema, type } from "minecs";

@Component()
export class TimeDilation extends Schema {
  @type("number")
  @defaultValue(0.5)
  amount: number;
}
