import { Component, type } from "minecs";
import { ComponentCategory } from "yage/systems/types";
import { Schema } from "minecs";

@Component(ComponentCategory.BEHAVIOR)
export class Radius extends Schema {
  @type("uint16")
  radius: number;
}
