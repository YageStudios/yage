import { ComponentCategory } from "../types";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { FrameRate, Frame, FrameEnd } from "yage/schemas/core/FrameRate";
import { DrawSystemImpl, System, SystemImpl } from "minecs";
import { DEPTHS } from "yage/constants/enums";
import { Column, Model, Text, UIFinal } from "yage/ui/final";

@System(FrameRate, Frame)
class FrameStartSystem extends SystemImpl<GameModel> {
  type = "FrameStart";
  static category: ComponentCategory = ComponentCategory.CORE;
  static depth = DEPTHS.CORE;

  run = (gameModel: GameModel, entity: number) => {
    gameModel(Frame, entity).frame = gameModel.frame;
    const data = gameModel.getSystem(FrameRateSystem).get(entity);

    // Wall-clock telemetry for the FPS readout only; never read by sim logic.
    // eslint-disable-next-line no-restricted-properties
    const startFrameStamp = performance.now();
    data.frameRate = 1000 / (startFrameStamp - data.startFrameStamp);
    data.startFrameStamp = startFrameStamp;
  };
}

@System(FrameEnd, Frame)
class FrameEndSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.CORE;
  static depth = DEPTHS.DRAW + 100000;

  run = (gameModel: GameModel, entity: number) => {
    const data = gameModel.getSystem(FrameRateSystem).get(entity);
    // Wall-clock telemetry for the FPS readout only; never read by sim logic.
    // eslint-disable-next-line no-restricted-properties
    data.stopFrameStamp = performance.now();

    data.averageFrameRate = data.averageFrameRate - data.averageFrameRate / 100 + data.frameRate / 100;
  };
}

@System(FrameRate)
export class FrameRateSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.CORE;

  entities: {
    [key: number]: {
      startFrameStamp: number;
      frameRate: number;
      stopFrameStamp: number;
      averageFrameRate: number;
      bodies: number;
    };
  } = {};
  init = (gameModel: GameModel, entity: number) => {
    this.entities[entity] = {
      // Wall-clock telemetry for the FPS readout only; never read by sim logic.
      // eslint-disable-next-line no-restricted-properties
      startFrameStamp: performance.now(),
      frameRate: 0,
      stopFrameStamp: 0,
      averageFrameRate: 60,
      bodies: 0,
    };

    gameModel.addComponent("Frame", entity);
    gameModel.addComponent("FrameStart", entity);
    gameModel.addComponent("FrameEnd", entity);
  };

  get(entity: number) {
    return (
      this.entities[entity] ||
      (this.entities[entity] = {
        startFrameStamp: 0,
        frameRate: 0,
        stopFrameStamp: 0,
        averageFrameRate: 60,
        bodies: 0,
      })
    );
  }
}

// Metrics HUD. Presentation-only: a UIFinal root on document.body in the draw
// step, skipped headless where there is no DOM to mount on.
const canPresentUI = (): boolean =>
  typeof document !== "undefined" && typeof document.createComment === "function";

interface FrameRateHudState {
  frame: string;
  fps: string;
  bodies: string;
}

@System(FrameRate)
export class RenderFramerateSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  private ui?: UIFinal;
  private state?: Model<FrameRateHudState>;

  init = (_gameModel: ReadOnlyGameModel, _entity: number) => {
    if (!canPresentUI() || this.ui) return;
    const ui = (this.ui = new UIFinal());
    const state = (this.state = new Model<FrameRateHudState>({
      frame: "Frame: 0",
      fps: "FPS: 0",
      bodies: "Bodies: 0",
    }));
    ui.scope.add(() => {
      this.state = undefined;
      state.dispose();
    });
    ui.mount(
      Column({
        id: "metrics",
        style: {
          position: "absolute", top: 10, right: 12, alignItems: "flex-end", gap: 4,
          textShadow: "1px 1px 2px #000000",
        },
      },
        Text(() => state.get<string>("frame"), { id: "frame", style: { fontSize: 20, textAlign: "right" } }),
        Text(() => state.get<string>("fps"), { id: "frameRate", style: { fontSize: 20, textAlign: "right" } }),
        Text(() => state.get<string>("bodies"), { id: "bodies", style: { fontSize: 20, textAlign: "right" } })));
  };

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (!this.state) return;
    const data = gameModel.getSystem(FrameRateSystem).get(entity);
    this.state.set("frame", `Frame: ${gameModel(Frame, entity).frame}`);
    this.state.set("fps", `FPS: ${data.averageFrameRate.toFixed(0)}`);
    this.state.set("bodies", `Bodies: ${data.bodies}`);
  };

  cleanup = () => {
    this.ui?.dispose();
    this.ui = undefined;
  };
}
