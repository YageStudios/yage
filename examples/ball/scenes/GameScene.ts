import type { Application } from "pixi.js";
import type { SceneTimestep } from "yage/game/Scene";
import { Scene } from "yage/game/Scene";
import { KeyMap } from "yage/inputs/InputManager";
import type { Viewport } from "pixi-viewport";
import "../components";

import { GameInstance } from "yage/game/GameInstance";
import { PlayerState } from "../types/PlayerState.types";

export class BallGameScene extends Scene {
  static sceneName = "BallGame";

  timestep: SceneTimestep = "fixed";
  dt = 16;

  lastTime = 0;
  paused = false;

  frameOffset = 10;
  frameStack: {
    [playerId: number]: { keys: KeyMap; frame: number }[];
  } = {};

  stateRequested = false;
  sendingState = false;
  listening = false;
  playerId = -1;

  instance: GameInstance<PlayerState>;

  constructor(pixiApp: Application, pixiViewport: Viewport) {
    super(pixiApp, pixiViewport);
  }

  public initialize = async (args: unknown[]): Promise<void> => {
    const { hosting, instance, wave } = args[0] as {
      hosting: boolean;
      instance: GameInstance<PlayerState>;
      wave: number;
    };
    this.instance = instance;

    const address = instance.options.connection.address + "game" + wave;

    await this.instance.initializeRoom(address, address); //host(address, address);
  };

  run = () => {
    this.instance.run();
  };

  public destroy = (): void => {
    super.destroy();
    this.paused = true;
    this.instance.gameModel.destroy();
    console.log("MinMediator: destroy");
  };
}
