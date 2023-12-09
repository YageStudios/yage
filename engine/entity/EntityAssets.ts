import { SpriteOptions } from "@/loader/SpriteLoader";
import { UIConfig } from "@/ui/UiConfigs";

export type EntityAsset =
  | ImageEntityAsset
  | SpriteSheetEntityAsset
  | {
      key: string;
      url: string;
      type: "spine" | "sound" | "animation" | "font" | "map" | "mapskin";
    };

export type ImageEntityAsset = {
  key: string;
  url: string;
  type: "image";
};

export type SpriteSheetEntityAsset = Partial<SpriteOptions> & {
  key: string;
  url: string;
  type: "spritesheet";
};

export type UIEntityAsset = {
  key: string;
  url: "";
  type: "ui";
  ui: UIConfig[];
};
