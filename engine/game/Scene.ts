import type { AnimatedImageBoxConfig } from "yage/ui/AnimatedImageBox";
import { AnimatedImageBox } from "yage/ui/AnimatedImageBox";
import type { BoxConfig } from "yage/ui/Box";
import { Box } from "yage/ui/Box";
import type { ButtonConfig } from "yage/ui/Button";
import { Button } from "yage/ui/Button";
import { Rectangle } from "yage/ui/Rectangle";
import type { TextConfig } from "yage/ui/Text";
import { Text } from "yage/ui/Text";
import type { TextInputConfig } from "yage/ui/TextInput";
import { TextInput } from "yage/ui/TextInput";
import { UIService } from "yage/ui/UIService";
import type { IDestroyOptions } from "pixi.js";
import { Container } from "pixi.js";
import { FIXED_TIMESTEP_MS } from "./Timing";
import Ticker from "./Ticker";
import { UIFinal, type UIFinalOptions } from "../ui/final/runtime";
import type { Child } from "../ui/final/nodes";
export type SceneTimestep = "fixed" | "continuous";

export type SceneUiConfig = {
  [key: string]:
    | {
        config: BoxConfig;
        type: "box";
        rect: { x: number; y: number; width: number; height: number };
      }
    | {
        config: TextConfig;
        type: "text";
        rect: { x: number; y: number; width: number; height: number };
      }
    | {
        config: ButtonConfig;
        type: "button";
        rect: { x: number; y: number; width: number; height: number };
      }
    | {
        config: TextInputConfig;
        type: "textInput";
        rect: { x: number; y: number; width: number; height: number };
      }
    | {
        config: AnimatedImageBoxConfig;
        type: "animatedImageBox";
        rect: { x: number; y: number; width: number; height: number };
      };
};

export class Scene extends Container {
  static sceneName: string;
  private _ui: UIService;
  uiElements: { [key: string]: Box | TextInput | Text | Button | AnimatedImageBox } = {};

  static uiConfig: SceneUiConfig = {};

  /** Scene-owned presentation UI. Never included in deterministic GameModel state. */
  uiFinal?: UIFinal;

  /** Mount once; later calls reconcile into the same root. Options apply only on creation. */
  mountUIFinal(content: Child, options: UIFinalOptions = {}): UIFinal {
    if (!this.uiFinal) {
      const ui = this.uiFinal = new UIFinal({ scheduling: "manual", ...options });
      // Presentation input repeat must not run once per simulation catch-up step.
      const presentation = new Ticker("continuous");
      presentation.add(dt => ui.frame(dt));
      ui.scope.add(() => { presentation.stop(); if (this.uiFinal === ui) this.uiFinal = undefined; });
      presentation.start();
    }
    return this.uiFinal.mount(content);
  }

  ui: { [key: string]: Box | Text | TextInput | Button | AnimatedImageBox | any } = new Proxy(this.uiElements, {
    get: (target, prop) => {
      return target[prop as any];
    },
    set: (target, prop, value) => {
      if (target[prop as any]) {
        UIService.getInstance().removeFromUI(target[prop as any]);
      }

      target[prop as any] = value;
      // console.log(UIService.getInstance());
      UIService.getInstance().addToUI(value);
      return true;
    },
    deleteProperty: (target, prop) => {
      if (!target[prop as any]) {
        return true;
      }
      UIService.getInstance().removeFromUI(target[prop as any]);
      delete target[prop as any];
      return true;
    },
  });

  public changeScene: (scene: string, ...args: any[]) => Promise<void> = () => Promise.resolve();

  constructor() {
    super();
    this.sortableChildren = true;

    // @ts-ignore
    Object.entries(this.constructor.uiConfig).forEach(([key, config]: [string, any]) => {
      if (config.type === "text") {
        this.ui[key] = new Text(new Rectangle(config.rect), config.config as TextConfig);
      } else if (config.type === "button") {
        this.ui[key] = new Button(new Rectangle(config.rect), config.config as ButtonConfig);
      } else if (config.type === "textInput") {
        this.ui[key] = new TextInput(new Rectangle(config.rect), config.config as TextConfig);
      } else if (config.type === "animatedImageBox") {
        this.ui[key] = new AnimatedImageBox(new Rectangle(config.rect), config.config as AnimatedImageBoxConfig);
      } else if (config.type === "box") {
        this.ui[key] = new Box(new Rectangle(config.rect), config.config as BoxConfig);
      }
    });
  }

  timestep: SceneTimestep = "fixed";
  dt = FIXED_TIMESTEP_MS;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  initialize: (args: unknown[]) => void | Promise<void> = () => {};
  run?: (dt: number) => void;

  destroy(options?: boolean | IDestroyOptions | undefined): void {
    try {
      this.uiFinal?.dispose();
    } finally {
      this.uiFinal = undefined;
      super.destroy(options);
      this.uiElements = {};
      UIService.getInstance().clearUI();
    }
  }
}
