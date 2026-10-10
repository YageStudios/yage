import { Component, Schema, type, defaultValue } from "minecs";

/** Declarative emitter state; Web Audio nodes stay in the local draw system. */
@Component()
export class SpatialAudio extends Schema {
  @type("string") @defaultValue("") sound: string;
  @type("boolean") @defaultValue(true) enabled: boolean;
  @type("number") @defaultValue(1) volume: number;
  @type("number") @defaultValue(100) refDistance: number;
  @type("number") @defaultValue(3000) maxDistance: number;
  @type("number") @defaultValue(1) rolloff: number;
  /** Disable metre-based air absorption when transforms use pixels. */
  @type("boolean") @defaultValue(true) air: boolean;
  @type("number") @defaultValue(0) occlusion: number;
  @type("object") @defaultValue({}) params: Record<string, number>;
  /** Increment to replay a one-shot; loops start once and follow the entity. */
  @type("number") @defaultValue(0) trigger: number;
}
