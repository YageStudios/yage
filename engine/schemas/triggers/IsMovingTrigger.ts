import { Component, defaultValue, type } from "minecs";
import { BaseTrigger } from "./BaseTrigger";

@Component()
export class IsMovingTrigger extends BaseTrigger {
  @type("boolean")
  @defaultValue(false)
  isMoving: boolean;

  @type("number")
  @defaultValue(100)
  movementDelay: number;

  @type("number")
  @defaultValue(0)
  startMovement: number;
}
