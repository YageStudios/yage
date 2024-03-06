import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import { System } from "@/components/System";
import { Component, Schema } from "@/decorators/type";
import { GameModel } from "@/game/GameModel";

@Component("FrameTest")
export class FrameTestSchema extends Schema {}

export class FrameTestSystem implements System {
  schema = FrameTestSchema;
  type = "FrameTest";
  depth = DEPTHS.CORE;
  intraFrame = 30;
  run() {
    console.log("frame test");
  }
}

registerSystem(FrameTestSystem);
