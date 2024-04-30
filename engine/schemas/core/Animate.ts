import { Schema, Component, type, defaultValue } from "minecs";
import { Spawn } from "yage/schemas/entity/Spawn";
import { AnimationEase } from "yage/constants/enums";

@Component()
export class AnimationTween extends Schema {
  @type("number")
  start: number;

  @type("number")
  end: number;

  @type("number")
  duration: number;

  @type("number")
  frameStart: number;

  @type(AnimationEase)
  @defaultValue(AnimationEase.LINEAR)
  ease: AnimationEase;
}

@Component()
export class Animation extends Schema {
  @type("string")
  property: string;

  @type("string")
  componentType: string;

  @type("boolean")
  @defaultValue(false)
  loop: boolean;

  @type("boolean")
  @defaultValue(false)
  relative: boolean;

  @type("number")
  @defaultValue(0)
  previousValue: number;

  @type([AnimationTween])
  tweens: AnimationTween[];

  @type(Spawn)
  spawnChildOnComplete: Spawn;

  @type("boolean")
  @defaultValue(false)
  applyToParent: boolean;
}

@Component()
export class Animate extends Schema {
  @type([Animation])
  animations: Animation[];
}
