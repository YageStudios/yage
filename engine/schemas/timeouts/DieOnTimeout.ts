import { Component, defaultValue, Schema, type } from "../../decorators/type";

@Component("DieOnTimeout")
export class DieOnTimeoutSchema extends Schema {
  @type("number")
  @defaultValue(0)
  endFrame: number;

  @type("number")
  @defaultValue(1)
  timeoutMs: number;
}
