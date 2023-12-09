import { Component, Schema, type } from "@/decorators/type";
import type { Random } from "@/utils/rand";

@Component("Random")
export class RandomSchema extends Schema {
  @type("object")
  random: Random;
}
