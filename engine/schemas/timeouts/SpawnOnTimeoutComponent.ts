import { RequireAtLeastOne } from "@/utils/typehelpers";
import { ComponentDataSchema } from "../../components/types";
import { Component, defaultValue, Schema, type } from "../../decorators/type";
import { SpawnSchema } from "@/components/entity/Spawn";

@Component("SpawnOnTimeout")
export class SpawnOnTimeoutSchema extends Schema {
  @type("number")
  @defaultValue(0)
  timeElapsed: number;

  @type("number")
  @defaultValue(1000)
  timeout: number;

  @type("boolean")
  @defaultValue(false)
  timedOut: boolean;

  @type([SpawnSchema])
  @defaultValue([])
  spawn: Partial<SpawnSchema>[];
}

@Component("MultiSpawnOnTimeout")
export class MultiSpawnOnTimeoutSchema extends Schema {
  @type([SpawnOnTimeoutSchema])
  @defaultValue([])
  timeouts: SpawnOnTimeoutSchema[];
}
