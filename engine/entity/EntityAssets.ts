import type { SoundOptions } from "yage/loader/SoundLoader";
import type { SpriteOptions } from "yage/loader/SpriteLoader";
import type { UIConfig } from "yage/ui/UiConfigs";

export type EntityAsset =
  | ImageEntityAsset
  | SpriteSheetEntityAsset
  | SoundAsset
  | {
      key: string;
      url: string;
      type: "spine" | "sound" | "animation" | "font" | "map" | "mapskin";
    };

export type SoundAsset = Partial<SoundOptions> & {
  key: string;
  url: string;
  type: "sound";
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
