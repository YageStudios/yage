import type { AnimatedImageBoxConfig } from "./AnimatedImageBox";
import type { BoxConfig } from "./Box";
import { Box } from "./Box";
import type { ButtonConfig } from "./Button";
import { Button } from "./Button";
import type { ImageBoxConfig } from "./ImageBox";
import { ImageBox } from "./ImageBox";
import type { Position} from "./Rectangle";
import type { TextConfig } from "./Text";
import { Text } from "./Text";
import type { TextInputConfig } from "./TextInput";
import { TextInput } from "./TextInput";

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
