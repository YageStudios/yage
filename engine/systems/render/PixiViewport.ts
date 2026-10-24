import type { QueryInstance} from "minecs";
import { DrawSystemImpl, System } from "minecs";
import { Viewport } from "pixi-viewport";
import type { ReadOnlyGameModel } from "yage/game/GameModel";
import { PixiViewport, PixiViewportCleanup } from "yage/schemas/render/PixiViewport";
import * as PIXI from "pixi.js";
import { DEPTHS } from "yage/constants/enums";
import { setGlobalSingleton } from "yage/global";

export interface PixiViewportOptions {
  /** Renderer clear colour (e.g. 0x10140f). Default: Pixi's default (black). */
  background?: number;
  /** Keep the drawing buffer between frames (needed for canvas screenshots). Default true. */
  preserveDrawingBuffer?: boolean;
  /** Scale the view so 1920 world units span the screen width. false keeps zoom 1. Default true. */
  baseZoom?: boolean;
  /** Keep Pixi's accessibility plugin (it adds a DOM overlay and listens to Tab). Default true. */
  accessibility?: boolean;
  /**
   * Use this application instead of creating one. The caller owns its canvas, placement and size
   * (the viewport follows `renderer.screen`), and it is not destroyed with the last viewport.
   * `background`/`preserveDrawingBuffer` are then the caller's to set.
   */
  app?: PIXI.Application;
  /** Create the app with Pixi's resizeTo (e.g. window): the canvas fills it and the viewport follows `renderer.screen`. */
  resizeTo?: Window | HTMLElement;
}

@System(PixiViewport)
export class PixiViewportSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static depth = DEPTHS.DRAW + 10000;

  // Static properties for shared resources
  private static pixiApp: PIXI.Application;
  private static viewports: Map<string, Viewport> = new Map();
  private static instanceCount = 0;
  private static activeRoomId = "";
  private static drawLogCount = 0;
  private static options: PixiViewportOptions = {};

  /** Configure the shared Pixi app. Call before the first PixiViewport entity is created. */
  static configure(options: PixiViewportOptions): void {
    if (PixiViewportSystem.pixiApp) throw new Error("PixiViewportSystem.configure must run before the first PixiViewport is created");
    PixiViewportSystem.options = { ...options };
  }

  /** The shared Pixi application (undefined until the first PixiViewport initializes). */
  static get app(): PIXI.Application | undefined {
    return PixiViewportSystem.pixiApp;
  }

  /** The viewport for a room (undefined when that room has no PixiViewport). */
  static viewportFor(roomId: string): Viewport | undefined {
    return PixiViewportSystem.viewports.get(roomId);
  }

  private static removeAccessibility(): void {
    const plugins = (PixiViewportSystem.pixiApp.renderer as any).plugins;
    plugins?.accessibility?.destroy?.();
    if (plugins) delete plugins.accessibility;
  }

  private static zoom(scale: number): number {
    return PixiViewportSystem.options.baseZoom === false ? 1 : scale;
  }

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
  }

  /** The app's size is managed outside the 16:9 letterbox (a caller's app, or resizeTo). */
  private static get managedSize(): boolean {
    return !!(PixiViewportSystem.options.app || PixiViewportSystem.options.resizeTo);
  }

  private initializeSharedPixi = () => {
    console.info("[yage-pixi] initialize start");
    if (PixiViewportSystem.options.app) {
      PixiViewportSystem.pixiApp = PixiViewportSystem.options.app;
      if (PixiViewportSystem.options.accessibility === false) PixiViewportSystem.removeAccessibility();
      return;
    }
    document.querySelectorAll(".pixi-canvas").forEach((el) => el.remove());

    const options = PixiViewportSystem.options;
    PixiViewportSystem.pixiApp = new PIXI.Application({
      autoStart: false,
      preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
      ...(options.background !== undefined ? { backgroundColor: options.background } : {}),
      ...(options.resizeTo ? { resizeTo: options.resizeTo } : {}),
    });
    PixiViewportSystem.pixiApp.stop();
    if (options.accessibility === false) PixiViewportSystem.removeAccessibility();
    const canvas = PixiViewportSystem.pixiApp.renderer.view as HTMLCanvasElement;
    canvas.className = "pixi-canvas";
    canvas.style.position = "fixed";
    canvas.style.display = "block";
    canvas.style.zIndex = "0";
    canvas.style.left = "0px";
    canvas.style.top = "0px";

    PixiViewportSystem.pixiApp.renderer.resize(window.innerWidth, (window.innerWidth * 9) / 16);

    // @ts-ignore
    document.body.appendChild(PixiViewportSystem.pixiApp.view);
    console.info("[yage-pixi] initialized", {
      canvasCount: document.querySelectorAll("canvas").length,
      width: PixiViewportSystem.pixiApp.renderer.width,
      height: PixiViewportSystem.pixiApp.renderer.height,
      resolution: PixiViewportSystem.pixiApp.renderer.resolution,
      contextLost: Boolean((PixiViewportSystem.pixiApp.renderer as any).gl?.isContextLost?.()),
    });
    canvas.addEventListener("webglcontextlost", (event) => {
      console.error("[yage-pixi] webglcontextlost", { defaultPrevented: event.defaultPrevented });
    });
    canvas.addEventListener("webglcontextrestored", () => {
      console.warn("[yage-pixi] webglcontextrestored");
    });

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
    if (!PixiViewportSystem.pixiApp && typeof window !== "undefined") {
      this.initializeSharedPixi();
    }

    const schema = gameModel.getTypedUnsafe(PixiViewport, entity);
    if (!gameModel.hasComponent(PixiViewportCleanup, entity)) {
      gameModel.addComponent(PixiViewportCleanup, entity);
    }
    this.roomId = gameModel.roomId;
    this.fillScreen = schema.fillScreen;
    this.minWidth = schema.minWidth;

    // Clean up existing viewport for this room if it exists
    if (PixiViewportSystem.viewports.has(this.roomId)) {
      PixiViewportSystem.viewports.get(this.roomId)?.destroy({ children: true });
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

    this.baseZoom = PixiViewportSystem.zoom(window.innerWidth / 1920);
    setGlobalSingleton("PIXI_BASE_ZOOM", this.baseZoom);

    // Initial viewport update
    this.updatePixiViewport(viewport);
    console.info("[yage-pixi] viewport initialized", {
      roomId: this.roomId,
      entity,
      frame: gameModel.frame,
      players: gameModel.players,
      localNetIds: gameModel.localNetIds,
      viewportVisible: viewport.visible,
      canvas: {
        width: (PixiViewportSystem.pixiApp.renderer.view as HTMLCanvasElement).width,
        height: (PixiViewportSystem.pixiApp.renderer.view as HTMLCanvasElement).height,
      },
    });
  };

  private updatePixiViewport = (viewport: Viewport) => {
    if (PixiViewportSystem.managedSize) {
      const { width, height } = PixiViewportSystem.pixiApp.renderer.screen;
      viewport.resize(width, height, viewport.worldWidth, viewport.worldHeight);
      const scale = PixiViewportSystem.zoom(width / 1920);
      if (PixiViewportSystem.options.baseZoom !== false) viewport.setZoom(scale, true);
      setGlobalSingleton("PIXI_BASE_ZOOM", scale);
      return;
    }
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
      scale = PixiViewportSystem.zoom(scale);
      viewport.setZoom(scale, true);
      setGlobalSingleton("PIXI_BASE_ZOOM", scale);
    } else {
      let width = window.innerWidth;
      let height = (window.innerWidth * 9) / 16;
      if (height > window.innerHeight) {
        height = window.innerHeight;
        width = (window.innerHeight * 16) / 9;
      }

      const fit = Math.min(width / 1920, height / 1080);
      const scaledWidth = 1920 * fit;
      const scaledHeight = 1080 * fit;
      const scale = PixiViewportSystem.zoom(fit);
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
    const viewport = PixiViewportSystem.viewports.get(this.roomId);

    if (viewport) {
      if (PixiViewportSystem.managedSize) {
        const screen = PixiViewportSystem.pixiApp.renderer.screen;
        if (viewport.screenWidth !== screen.width || viewport.screenHeight !== screen.height) this.updatePixiViewport(viewport);
      }
      if (PixiViewportSystem.drawLogCount < 3) {
        PixiViewportSystem.drawLogCount += 1;
        console.info("[yage-pixi] draw", {
          roomId: this.roomId,
          frame: gameModel.frame,
          players: gameModel.players,
          localNetIds: gameModel.localNetIds,
          viewportVisible: viewport.visible,
          stageChildren: PixiViewportSystem.pixiApp.stage.children.length,
          contextLost: Boolean((PixiViewportSystem.pixiApp.renderer as any).gl?.isContextLost?.()),
        });
      }
      PixiViewportSystem.activeRoomId = this.roomId;
      PixiViewportSystem.viewports.forEach((candidate, roomId) => {
        candidate.visible = roomId === PixiViewportSystem.activeRoomId;
      });
      PixiViewportSystem.pixiApp.renderer.render(PixiViewportSystem.pixiApp.stage);
    }
  };

  cleanup(gameModel: ReadOnlyGameModel) {
    // Clean up viewport for this room
    if (PixiViewportSystem.viewports.has(this.roomId)) {
      PixiViewportSystem.viewports.get(this.roomId)?.destroy({ children: true });
      PixiViewportSystem.viewports.delete(this.roomId);
    }

    PixiViewportSystem.instanceCount--;

    // Clean up shared resources if this is the last instance
    if (PixiViewportSystem.instanceCount === 0) {
      if (!PixiViewportSystem.options.app) PixiViewportSystem.pixiApp?.destroy(true);
      // @ts-ignore
      PixiViewportSystem.pixiApp = null;
      PixiViewportSystem.viewports.clear();
      PixiViewportSystem.activeRoomId = "";
    }
  }
}

@System(PixiViewportCleanup)
export class PixiViewportCleanupSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static depth = -1;

  run = (gameModel: ReadOnlyGameModel) => {
    if (gameModel.localNetIds.length > 0) {
      return;
    }
    console.warn("[yage-pixi] hiding viewport: no local players", {
      roomId: gameModel.roomId,
      frame: gameModel.frame,
      players: gameModel.players,
      localNetIds: gameModel.localNetIds,
    });
    const pixiSystem = gameModel.getSystem(PixiViewportSystem);

    const viewport = pixiSystem.viewport;
    if (viewport) {
      viewport.visible = false;
      pixiSystem.pixiApp.renderer.render(pixiSystem.pixiApp.stage);
    }
  };
}
