import { BaseTrigger } from "./BaseTrigger";
import { Component, required, type } from "minecs";

@Component()
export class TimeTrigger extends BaseTrigger {
  @type("number")
  @required()
  value: number;

  @type("number")
  initialTime: number;
}
