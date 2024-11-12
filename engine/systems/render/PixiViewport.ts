import { DrawSystemImpl, QueryInstance, System } from "minecs";
import { Viewport } from "pixi-viewport";
import type { ReadOnlyGameModel } from "yage/game/GameModel";
import { PixiViewport, PixiViewportCleanup } from "yage/schemas/render/PixiViewport";
import * as PIXI from "pixi.js";
import { DEPTHS } from "yage/constants/enums";
import { setGlobalSingleton } from "yage/global";

@System(PixiViewport)
export class PixiViewportSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static depth = DEPTHS.DRAW + 10000;

  // Static properties for shared resources
  private static pixiApp: PIXI.Application;
  private static viewports: Map<string, Viewport> = new Map();
  private static instanceCount = 0;

  // Instance properties
  private roomId: string;
  private fillScreen: boolean;
  private minWidth: number;
  baseZoom: number;

  get viewport(): Viewport {
    return PixiViewportSystem.viewports.get(this.roomId)!;
  }

  get pixiApp() {
    return PixiViewportSystem.pixiApp;
  }

  constructor(query: QueryInstance<ReadOnlyGameModel>) {
    super(query);
    PixiViewportSystem.instanceCount++;

    // Initialize shared PIXI application if this is the first instance
    if (!PixiViewportSystem.pixiApp && typeof window !== "undefined") {
      this.initializeSharedPixi();
    }
  }

  private initializeSharedPixi = () => {
    document.querySelectorAll(".pixi-canvas").forEach((el) => el.remove());

    PixiViewportSystem.pixiApp = new PIXI.Application();
    const canvas = PixiViewportSystem.pixiApp.renderer.view as HTMLCanvasElement;
    canvas.className = "pixi-canvas";
    canvas.style.position = "absolute";
    canvas.style.display = "block";
    canvas.style.zIndex = "-1";

    PixiViewportSystem.pixiApp.renderer.resize(window.innerWidth, (window.innerWidth * 9) / 16);

    // @ts-ignore
    document.body.appendChild(PixiViewportSystem.pixiApp.view);

    // Setup PIXI Inspector if available
    (window as any).__PIXI_INSPECTOR_GLOBAL_HOOK__?.register({ PIXI: PIXI });
    (window as any).__PIXI_APP__ = PixiViewportSystem.pixiApp;

    // Global resize handler
    window.addEventListener("resize", () => {
      PixiViewportSystem.viewports.forEach((viewport) => {
        this.updatePixiViewport(viewport);
      });
    });
  };

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const schema = gameModel.getTypedUnsafe(PixiViewport, entity);
    this.roomId = gameModel.roomId;
    this.fillScreen = schema.fillScreen;
    this.minWidth = schema.minWidth;

    // Clean up existing viewport for this room if it exists
    if (PixiViewportSystem.viewports.has(this.roomId)) {
      PixiViewportSystem.viewports.get(this.roomId)?.destroy();
      PixiViewportSystem.viewports.delete(this.roomId);
    }

    // Create new viewport
    const viewport = new Viewport({
      screenWidth: window.innerWidth,
      screenHeight: (window.innerWidth * 9) / 16,
      worldWidth: 1000000,
      worldHeight: 1000000,
      events: PixiViewportSystem.pixiApp.renderer.events,
    });

    viewport.sortableChildren = true;
    PixiViewportSystem.pixiApp.stage.addChild(viewport as any);
    PixiViewportSystem.viewports.set(this.roomId, viewport);

    this.baseZoom = window.innerWidth / 1920;
    setGlobalSingleton("PIXI_BASE_ZOOM", this.baseZoom);

    // Initial viewport update
    this.updatePixiViewport(viewport);
  };

  private updatePixiViewport = (viewport: Viewport) => {
    if (this.fillScreen) {
      const windowWidth = Math.min(window.innerWidth, window.outerWidth);
      const windowHeight = Math.min(window.innerHeight, window.outerHeight);

      const canvas = PixiViewportSystem.pixiApp.renderer.view as HTMLCanvasElement;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      canvas.style.left = "0px";
      canvas.style.top = "0px";

      PixiViewportSystem.pixiApp.renderer.resize(window.innerWidth, window.innerHeight);
      viewport.resize(window.innerWidth, window.innerHeight, viewport.worldWidth, viewport.worldHeight);

      let scale = window.innerWidth / 1920;
      if (windowWidth < this.minWidth) {
        scale = (this.minWidth / windowWidth) * scale;
      }
      viewport.setZoom(scale, true);
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
      const canvas = PixiViewportSystem.pixiApp.renderer.view as HTMLCanvasElement;

      canvas.style.width = `${scaledWidth}px`;
      canvas.style.height = `${scaledHeight}px`;
      canvas.style.left = `${(window.innerWidth - scaledWidth) / 2}px`;
      canvas.style.top = `${(window.innerHeight - scaledHeight) / 2}px`;

      PixiViewportSystem.pixiApp.renderer.resize(width, height);
      viewport.resize(width, height, viewport.worldWidth, viewport.worldHeight);
      viewport.setZoom(scale, true);
      setGlobalSingleton("PIXI_BASE_ZOOM", scale);
    }
  };

  run = (gameModel: ReadOnlyGameModel) => {
    // Only render if this is the last/active instance
    const viewport = PixiViewportSystem.viewports.get(this.roomId);

    if (viewport) {
      if (viewport.visible === false && gameModel.players.length > 0) {
        viewport.visible = true;
      }
      PixiViewportSystem.pixiApp.renderer.render(PixiViewportSystem.pixiApp.stage);
    }
  };

  cleanup(gameModel: ReadOnlyGameModel) {
    // Clean up viewport for this room
    if (PixiViewportSystem.viewports.has(this.roomId)) {
      PixiViewportSystem.viewports.get(this.roomId)?.destroy();
      PixiViewportSystem.viewports.delete(this.roomId);
    }

    PixiViewportSystem.instanceCount--;

    // Clean up shared resources if this is the last instance
    if (PixiViewportSystem.instanceCount === 0) {
      PixiViewportSystem.pixiApp?.destroy(true);
      // @ts-ignore
      PixiViewportSystem.pixiApp = null;
      PixiViewportSystem.viewports.clear();
    }
  }
}

@System(PixiViewportCleanup)
export class PixiViewportCleanupSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static depth = -1;

  run = (gameModel: ReadOnlyGameModel) => {
    if (gameModel.players.length > 0) {
      return;
    }
    const pixiSystem = gameModel.getSystem(PixiViewportSystem);

    const viewport = pixiSystem.viewport;
    if (viewport) {
      viewport.visible = false;
      pixiSystem.pixiApp.renderer.render(pixiSystem.pixiApp.stage);
    }
  };
}
