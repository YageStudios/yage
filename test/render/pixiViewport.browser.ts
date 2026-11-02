/**
 * PixiViewportSystem.configure in a real browser (scripts/test-pixi-viewport-browser.mjs bundles
 * this and runs it in headless Chromium): resizeTo, a caller's app, and baseZoom. Each case drives
 * one PixiViewport entity through a LeanGameModel and destroys it, so the shared app resets.
 */
import * as PIXI from "pixi.js";
import { createLeanGameModel } from "yage/game/LeanGameModel";
import { PixiViewport } from "yage/schemas/render/PixiViewport";
import { PixiViewportSystem, PixiViewportCleanupSystem, type PixiViewportOptions } from "yage/systems/render/PixiViewport";
import { leanWorldType } from "yage/world/lean";

type Result = { name: string; pass: boolean; error?: string };
const Scene = leanWorldType({ size: 8, systems: [PixiViewportSystem as any, PixiViewportCleanupSystem as any] });

const check = (condition: boolean, message: string, detail?: unknown) => {
  if (!condition) throw new Error(`${message}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** A scene with one PixiViewport under `options`; returns the model and its room's viewport. */
const mounted: { destroy(): void }[] = [];
const mount = (options: PixiViewportOptions) => {
  PixiViewportSystem.configure(options);
  const model = createLeanGameModel({ world: Scene, roomId: "room" });
  mounted.push(model);
  model.addComponent(PixiViewport, model.addEntity());
  model.run();
  const viewport = PixiViewportSystem.viewportFor("room")!;
  check(!!viewport, "no viewport for the room");
  return { model, viewport, app: PixiViewportSystem.app! };
};

const box = (width: number, height: number) => {
  const el = document.createElement("div");
  el.style.cssText = `position:absolute;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.appendChild(el);
  return el;
};

const cases: [string, () => void][] = [
  [
    "cleanup: a viewport stays visible for its player and hides when the player leaves",
    () => {
      const { model, viewport } = mount({});
      const cleanup = model.getSystem(PixiViewportCleanupSystem as any) as PixiViewportCleanupSystem;
      cleanup.run(model as any);
      check(viewport.visible, "hid a viewport with a local player");
      model.localNetIds = [];
      cleanup.run(model as any);
      check(!viewport.visible, "kept a viewport after the player left");
      model.destroy();
    },
  ],
  [
    "renderWhen: preparation and resize continue while drawing waits for the caller",
    () => {
      let ready = false;
      const own = new PIXI.Application({ width: 640, height: 360, autoStart: false });
      document.body.appendChild(own.view as HTMLCanvasElement);
      let renders = 0;
      const render = own.renderer.render.bind(own.renderer);
      own.renderer.render = (...args) => { renders++; return render(...args); };
      let model: ReturnType<typeof createLeanGameModel> | undefined;
      try {
        const mounted = mount({ app: own, renderWhen: () => ready });
        model = mounted.model;
        const { viewport } = mounted;
        check(renders === 0, "rendered before the caller was ready", renders);
        own.renderer.resize(800, 450);
        model.run();
        check(viewport.screenWidth === 800, "resize stopped while rendering was held");
        check(renders === 0, "rendered while held", renders);
        ready = true;
        model.run();
        check(renders === 1, "did not render when released", renders);
        ready = false;
        model.run();
        check(renders === 1, "did not hold a later draw", renders);
      } finally {
        model?.destroy();
        own.destroy(true);
      }
    },
  ],
  [
    "resizeTo: the app fills the element, the viewport follows renderer.screen on draw, base zoom spans 1920 units",
    () => {
      const el = box(800, 450);
      const { model, viewport, app } = mount({ resizeTo: el });
      check(app.renderer.screen.width === 800 && app.renderer.screen.height === 450, "app not sized to the element", app.renderer.screen);
      check(viewport.screenWidth === 800 && viewport.screenHeight === 450, "viewport not sized to the screen", [viewport.screenWidth, viewport.screenHeight]);
      check(near(viewport.scale.x, 800 / 1920), "base zoom", viewport.scale.x);
      // Not letterboxed: the canvas keeps Pixi's own size, with no 16:9 fit in its css.
      const canvas = app.view as HTMLCanvasElement;
      check(canvas.width === 800 * app.renderer.resolution && canvas.style.width === "", "canvas size", [canvas.width, canvas.style.width]);

      el.style.width = "960px";
      el.style.height = "300px";
      app.resize();
      model.run();
      check(viewport.screenWidth === 960 && viewport.screenHeight === 300, "viewport did not follow a resize", [viewport.screenWidth, viewport.screenHeight]);
      check(near(viewport.scale.x, 0.5), "base zoom after resize", viewport.scale.x);
      model.destroy();
      check(PixiViewportSystem.app === null || PixiViewportSystem.app === undefined, "app kept after the last viewport");
      check(!canvas.isConnected || !(app as any).renderer, "own app not destroyed");
      el.remove();
    },
  ],
  [
    "app: the caller's application is used, followed on draw and not destroyed",
    () => {
      const own = new PIXI.Application({ width: 640, height: 360, autoStart: false });
      document.body.appendChild(own.view as HTMLCanvasElement);
      const { model, viewport, app } = mount({ app: own });
      check(app === own, "not the caller's app");
      check(document.querySelectorAll("canvas").length === 1, "created a second canvas", document.querySelectorAll("canvas").length);
      check(viewport.screenWidth === 640 && viewport.screenHeight === 360, "viewport size", [viewport.screenWidth, viewport.screenHeight]);
      check(near(viewport.scale.x, 640 / 1920), "base zoom", viewport.scale.x);
      own.renderer.resize(1280, 720);
      model.run();
      check(viewport.screenWidth === 1280 && near(viewport.scale.x, 1280 / 1920), "viewport did not follow the app", [viewport.screenWidth, viewport.scale.x]);
      model.destroy();
      check(!!own.renderer && !!own.stage && (own.view as HTMLCanvasElement).isConnected, "the caller's app was destroyed");
      own.destroy(true);
    },
  ],
  [
    "baseZoom false: zoom stays 1 with resizeTo and with the default letterbox",
    () => {
      const el = box(800, 450);
      const sized = mount({ resizeTo: el, baseZoom: false });
      check(sized.viewport.scale.x === 1, "zoom with resizeTo", sized.viewport.scale.x);
      el.style.width = "1600px";
      sized.app.resize();
      sized.model.run();
      check(sized.viewport.screenWidth === 1600 && sized.viewport.scale.x === 1, "zoom after resize", [sized.viewport.screenWidth, sized.viewport.scale.x]);
      sized.model.destroy();
      el.remove();

      const boxed = mount({ baseZoom: false });
      check(boxed.viewport.scale.x === 1, "zoom in the letterbox", boxed.viewport.scale.x);
      boxed.model.destroy();
    },
  ],
  [
    "defaults: a 16:9 letterbox scaled so 1920 units span it",
    () => {
      const { model, viewport, app } = mount({});
      const fit = Math.min(window.innerWidth, (window.innerHeight * 16) / 9) / 1920;
      const canvas = app.view as HTMLCanvasElement;
      check(near(viewport.scale.x, fit), "letterbox zoom", [viewport.scale.x, fit]);
      check(canvas.style.width === `${1920 * fit}px`, "letterbox css width", canvas.style.width);
      model.destroy();
    },
  ],
];

(window as any).runPixiViewportTests = (): Result[] =>
  cases.map(([name, run]) => {
    try {
      run();
      return { name, pass: true };
    } catch (error: any) {
      return { name, pass: false, error: String(error?.stack ?? error) };
    } finally {
      // A failed case must not leave the shared app behind for the next one.
      for (const model of mounted.splice(0)) model.destroy();
    }
  });
