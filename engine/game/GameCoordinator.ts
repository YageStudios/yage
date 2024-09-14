import type { Scene } from "./Scene";
import Ticker from "./Ticker";
import { assignGlobalSingleton } from "yage/global";

export class GameCoordinator {
  scene: string;
  scenes: { [key: string]: () => Scene } = {};
  currentScene: Scene;
  ticker: Ticker;
  fillScreen: boolean = true;
  minWidth: number = 1080;
  minHeight: number = 1080;

  baseZoom: number;
  // instance: GameInstance;

  constructor() {
    console.log("GAMECOORDINATOR CONSTRUCTED");
  }

  registerScene(scene: typeof Scene) {
    this.scenes[scene.sceneName.toLocaleLowerCase()] = () => {
      const nextScene = new scene();
      nextScene.changeScene = this.changeScene.bind(this);
      return nextScene;
    };
  }

  initialize(scene: string | typeof Scene): void {
    // initialize(scene: string, preload?: () => Promise<void>): void;
    // initialize(instance: GameInstance, preload?: () => Promise<void>): void;
    // initialize(
    //   scene: string | GameInstance,
    //   instance?: GameInstance | (() => Promise<void>),
    //   preload?: () => Promise<void>
    // ) {
    this.changeScene(scene);
  }

  async changeScene(scene: string | typeof Scene, ...args: any[]) {
    if (typeof scene === "string") {
      scene = scene.toLocaleLowerCase();
    } else {
      scene = scene.sceneName.toLocaleLowerCase();
    }
    if (this.currentScene) {
      // this.pixiApp.stage.removeChild(this.currentScene as DisplayObject);
      this.currentScene.destroy();
    }
    this.currentScene = this.scenes[scene]();
    await this.currentScene.initialize(args ?? []);

    if (this.ticker) {
      this.ticker.stop();
    }
    this.ticker = new Ticker(this.currentScene.timestep, 1000 / this.currentScene.dt ?? 60);
    this.ticker.add(this.run.bind(this));
    this.ticker.start();
  }

  run(dt: number) {
    if (this.currentScene && this.currentScene.run) {
      this.currentScene.run(this.currentScene.timestep === "fixed" ? this.currentScene.dt : dt);
    }
  }

  public static GetInstance() {
    return assignGlobalSingleton("gameCoordinator", () => new GameCoordinator()) as GameCoordinator;
  }
}
