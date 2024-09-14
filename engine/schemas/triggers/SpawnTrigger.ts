import { Component, type } from "minecs";
import { BaseTrigger } from "./BaseTrigger";

@Component()
export class SpawnTrigger extends BaseTrigger {
  @type("string")
  spawnName: string;
}
