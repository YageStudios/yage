import { AnimatedImageBox, AnimatedImageBoxConfig } from "./AnimatedImageBox";
import { Box, BoxConfig } from "./Box";
import { Button, ButtonConfig } from "./Button";
import { ImageBox, ImageBoxConfig } from "./ImageBox";
import { Position, Rectangle } from "./Rectangle";
import { Text, TextConfig } from "./Text";
import { TextInput, TextInputConfig } from "./TextInput";
import { UIElement } from "./UIElement";

export type UIConfig = {
  type: "box" | "text" | "button" | "input" | "animatedImageBox" | "image";
  name?: string;
  rect: Position;
  config: BoxConfig | TextConfig | ButtonConfig | TextInputConfig | AnimatedImageBoxConfig | ImageBoxConfig;
};

export const createByType = (config: UIConfig) => {
  switch (config.type) {
    case "box":
      return new Box(config.rect, config.config as BoxConfig);
    case "text":
      return new Text(config.rect, config.config as TextConfig);
    case "button":
      return new Button(config.rect, config.config as ButtonConfig);
    case "input":
      return new TextInput(config.rect, config.config as TextInputConfig);
    case "animatedImageBox":
      throw new Error("AnimatedImageBox is not supported yet");
    // return new AnimatedImageBox(config.rect, config.config as AnimatedImageBoxConfig);
    case "image":
      return new ImageBox(config.rect, config.config as ImageBoxConfig);
    default:
      throw new Error(`Unknown UI type ${config.type}`);
  }
};
