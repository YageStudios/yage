import { Component, defaultValue, type } from "minecs";
import { BaseTrigger } from "./BaseTrigger";

@Component()
export class IsStandingTrigger extends BaseTrigger {
  @type("boolean")
  @defaultValue(true)
  isMoving: boolean;

  @type("number")
  @defaultValue(100)
  movementDelay: number;

  @type("number")
  @defaultValue(0)
  stopMovement: number;
}
