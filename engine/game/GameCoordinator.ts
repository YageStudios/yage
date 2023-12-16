import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";
import type { Scene } from "./Scene";
import Ticker from "./Ticker";
import { GameInstance } from "./GameInstance";
import { init } from "@dimforge/rapier2d-compat";
import { initial } from "lodash";
import { assignGlobalSingleton } from "@/global";

export class GameCoordinator {
  scene: string;
  scenes: { [key: string]: () => Scene } = {};
  currentScene: Scene;
  pixiApp: PIXI.Application;
  pixiViewport: Viewport;
  ticker: Ticker;
  // instance: GameInstance;

  constructor() {
    console.log("GAMECOORDINATOR CONSTRUCTED");
    this.setupPixi();
  }

  private setupPixi() {
    if (this.pixiApp) {
      document.querySelectorAll(".pixi-canvas").forEach((el) => el.remove());
    }
    this.pixiApp = new PIXI.Application();
    const canvas = this.pixiApp.renderer.view as HTMLCanvasElement;
    canvas.className = "pixi-canvas";
    canvas.style.position = "absolute";
    canvas.style.display = "block";
    canvas.style.zIndex = "-10";
    // @ts-ignore
    this.pixiApp.renderer.background.color = 0x000000;

    this.pixiApp.renderer.resize(window.innerWidth, (window.innerWidth * 9) / 16);
    this.pixiApp.ticker.stop();

    const viewport = new Viewport({
      screenWidth: window.innerWidth,
      screenHeight: (window.innerWidth * 9) / 16,
      worldWidth: 1000000,
      worldHeight: 1000000,

      events: this.pixiApp.renderer.events, // the interaction module is important for wheel to work properly when renderer.view is placed or scaled
    });
    viewport.setZoom(window.innerWidth / 1920, true);

    // Listen for window resize events
    window.removeEventListener("resize", this.onResize);
    window.addEventListener("resize", this.onResize);

    viewport.sortableChildren = true;

    this.pixiApp.stage.addChild(viewport);
    this.pixiViewport = viewport;

    this.onResize();

    // @ts-ignore
    document.body.appendChild(this.pixiApp.view);

    (window as any).__PIXI_INSPECTOR_GLOBAL_HOOK__ &&
      (window as any).__PIXI_INSPECTOR_GLOBAL_HOOK__.register({ PIXI: PIXI });
  }

  // Resize handler
  onResize = () => {
    let width = window.innerWidth;
    let height = (window.innerWidth * 9) / 16;
    if (height > window.innerHeight) {
      height = window.innerHeight;
      width = (window.innerHeight * 16) / 9;
    }

    const scale = Math.min(width / 1920, height / 1080);
    const scaledWidth = 1920 * scale;
    const scaledHeight = 1080 * scale;
    const canvas = this.pixiApp.renderer.view as HTMLCanvasElement;

    canvas.style.width = `${scaledWidth}px`;
    canvas.style.height = `${scaledHeight}px`;
    canvas.style.left = `${(window.innerWidth - scaledWidth) / 2}px`;
    canvas.style.top = `${(window.innerHeight - scaledHeight) / 2}px`;

    // Resize the pixi app's renderer
    this.pixiApp.renderer.resize(width, height);

    // Resize the pixi viewport
    this.pixiViewport.resize(width, height, this.pixiViewport.worldWidth, this.pixiViewport.worldHeight);
    this.pixiViewport.setZoom(scale, true);
  };

  registerScene(scene: typeof Scene) {
    this.scenes[scene.sceneName.toLocaleLowerCase()] = () => {
      const nextScene = new scene(this.pixiApp, this.pixiViewport);
      nextScene.changeScene = this.changeScene.bind(this);
      return nextScene;
    };
  }

  initialize(scene: string): void {
    // initialize(scene: string, preload?: () => Promise<void>): void;
    // initialize(instance: GameInstance, preload?: () => Promise<void>): void;
    // initialize(
    //   scene: string | GameInstance,
    //   instance?: GameInstance | (() => Promise<void>),
    //   preload?: () => Promise<void>
    // ) {
    if (typeof scene === "string") {
      this.changeScene(scene);
    } else {
      // this.changeScene("projectvlobby", scene);
    }
  }

  async changeScene(scene: string, ...args: any[]) {
    scene = scene.toLocaleLowerCase();
    if (this.currentScene) {
      // this.pixiApp.stage.removeChild(this.currentScene as DisplayObject);
      this.currentScene.destroy();
      this.pixiApp.destroy(false, {
        children: true,
        texture: false,
        baseTexture: false,
      });
      this.setupPixi();
    }
    this.currentScene = this.scenes[scene]();
    this.pixiApp.stage.addChild(this.currentScene);
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
    this.pixiApp.renderer.render(this.pixiApp.stage);
  }

  public static GetInstance() {
    return assignGlobalSingleton("gameCoordinator", () => new GameCoordinator());
  }
}
