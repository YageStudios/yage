import { ComponentDataSchema } from "../../components/types";
import { Component, defaultValue, Schema, type } from "../../decorators/type";
import { SpawnSchema } from "@/components/entity/Spawn";

@Component("DestroyOnTimeout")
export class DestroyOnTimeoutSchema extends Schema {
  @type("number")
  @defaultValue(0)
  endFrame: number;

  @type("number")
  @defaultValue(1)
  timeoutMs: number;

  @type("string")
  @defaultValue("")
  component: string;

  @type([SpawnSchema])
  @defaultValue([])
  spawnOnTimeout: SpawnSchema[];

  @type([ComponentDataSchema])
  @defaultValue([])
  applyOnTimeout: ComponentDataSchema[];
}

@Component("MultiDestroyOnTimeout")
export class MultiDestroyOnTimeoutSchema extends Schema {
  @type([DestroyOnTimeoutSchema])
  @defaultValue([])
  timeouts: DestroyOnTimeoutSchema[];
}
