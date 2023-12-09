import { AnimatedImageBox, AnimatedImageBoxConfig } from "@/ui/AnimatedImageBox";
import { Box, BoxConfig } from "@/ui/Box";
import { Button, ButtonConfig } from "@/ui/Button";
import { Rectangle } from "@/ui/Rectangle";
import { Text, TextConfig } from "@/ui/Text";
import { TextInput, TextInputConfig } from "@/ui/TextInput";
import { UIService } from "@/ui/UIService";
import type { Viewport } from "pixi-viewport";
import type { Application, IDestroyOptions } from "pixi.js";
import { Container } from "pixi.js";
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

  ui: { [key: string]: Box | Text | TextInput | Button | AnimatedImageBox | any } = new Proxy(this.uiElements, {
    get: (target, prop) => {
      return target[prop as any];
    },
    set: (target, prop, value) => {
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

  constructor(public pixiApp: Application, public pixiViewport: Viewport) {
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
  dt = 16.666666666666668;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  initialize: (args: unknown[]) => void | Promise<void> = () => {};
  run?: (dt: number) => void;

  destroy(options?: boolean | IDestroyOptions | undefined): void {
    super.destroy(options);
    this.uiElements = {};
    UIService.getInstance().clearUI();
  }
}
