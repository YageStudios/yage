import { DrawSystemImpl, System } from "minecs";
import { Viewport } from "pixi-viewport";
import type { ReadOnlyGameModel } from "yage/game/GameModel";
import { PixiViewport } from "yage/schemas/render/PixiViewport";
import * as PIXI from "pixi.js";
import { DEPTHS } from "yage/constants/enums";
import { setGlobalSingleton } from "yage/global";

@System(PixiViewport)
export class PixiViewportSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static depth = DEPTHS.DRAW + 10000;
  viewport: Viewport;
  baseZoom: number;
  fillScreen: boolean;
  minWidth: number;

  pixiApp: PIXI.Application;

  constructor(query: any) {
    super(query);
    console.error("PixiViewportSystem constructor");
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (this.viewport) {
      this.viewport.destroy();
    }
    const schema = gameModel.getTypedUnsafe(PixiViewport, entity);
    this.fillScreen = schema.fillScreen;
    this.minWidth = schema.minWidth;
    this.initializePixi();
    // const element = document.getElementById(schema.elementId);
    // if (!element) {
    //   throw new Error(`Element with id ${schema.elementId} not found`);
    // }
  };

  run = (gameModel: ReadOnlyGameModel) => {
    this.pixiApp.renderer.render(this.pixiApp.stage);
  };

  updatePixiViewport = (pixiApp: PIXI.Application, pixiViewport: Viewport) => {
    if (this.fillScreen) {
      const windowWidth = Math.min(window.innerWidth, window.outerWidth);
      const windowHeight = Math.min(window.innerHeight, window.outerHeight);

      const canvas = pixiApp.renderer.view as HTMLCanvasElement;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      canvas.style.left = "0px";
      canvas.style.top = "0px";

      // Resize the pixi app's renderer
      pixiApp.renderer.resize(window.innerWidth, window.innerHeight);

      // Resize the pixi viewport
      pixiViewport.resize(window.innerWidth, window.innerHeight, pixiViewport.worldWidth, pixiViewport.worldHeight);
      let scale = window.innerWidth / 1920;
      if (windowWidth < this.minWidth) {
        scale = (this.minWidth / windowWidth) * scale;
      }
      pixiViewport.setZoom(scale, true);
      setGlobalSingleton("PIXI_BASE_ZOOM", scale);
    } else {
      let width = window.innerWidth;
      let height = (window.innerWidth * 9) / 16;
      if (height > window.innerHeight) {
        height = window.innerHeight;
        width = (window.innerHeight * 16) / 9;
      }

      const scale = Math.min(width / 1920, height / 1080);
      const scaledWidth = 1920 * scale;
      const scaledHeight = 1080 * scale;
      const canvas = pixiApp.renderer.view as HTMLCanvasElement;

      canvas.style.width = `${scaledWidth}px`;
      canvas.style.height = `${scaledHeight}px`;
      canvas.style.left = `${(window.innerWidth - scaledWidth) / 2}px`;
      canvas.style.top = `${(window.innerHeight - scaledHeight) / 2}px`;

      // Resize the pixi app's renderer
      pixiApp.renderer.resize(width, height);

      // Resize the pixi viewport
      pixiViewport.resize(width, height, pixiViewport.worldWidth, pixiViewport.worldHeight);
      pixiViewport.setZoom(scale, true);
      setGlobalSingleton("PIXI_BASE_ZOOM", scale);
    }
  };

  initializePixi = async () => {
    // let pixiApp: PIXI.Application;
    // let pixiViewport: Viewport;

    document.querySelectorAll(".pixi-canvas").forEach((el) => el.remove());
    const pixiApp = new PIXI.Application();
    const canvas = pixiApp.renderer.view as HTMLCanvasElement;
    canvas.className = "pixi-canvas";
    canvas.style.position = "absolute";
    canvas.style.display = "block";
    canvas.style.zIndex = "-1";
    1;
    pixiApp.renderer.resize(window.innerWidth, (window.innerWidth * 9) / 16);
    // pixiApp.ticker.stop();

    const viewport = new Viewport({
      screenWidth: window.innerWidth,
      screenHeight: (window.innerWidth * 9) / 16,
      worldWidth: 1000000,
      worldHeight: 1000000,

      events: pixiApp.renderer.events, // the interaction module is important for wheel to work properly when renderer.view is placed or scaled
    });

    this.baseZoom = window.innerWidth / 1920;
    setGlobalSingleton("PIXI_BASE_ZOOM", this.baseZoom);

    window.addEventListener("resize", () => this.updatePixiViewport(pixiApp, viewport));

    viewport.sortableChildren = true;

    pixiApp.stage.addChild(viewport as any);
    const pixiViewport = viewport;

    // @ts-ignore
    document.body.appendChild(pixiApp.view);

    (window as any).__PIXI_INSPECTOR_GLOBAL_HOOK__ &&
      (window as any).__PIXI_INSPECTOR_GLOBAL_HOOK__.register({ PIXI: PIXI });

    (window as any).__PIXI_APP__ = pixiApp;

    this.pixiApp = pixiApp;
    this.viewport = pixiViewport;
  };
}
