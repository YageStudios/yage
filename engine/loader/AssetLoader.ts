import type { ImageOptions, ImageObj } from "./ImageLoader";
import ImageLoader from "./ImageLoader";
import type { Sprite, SpriteOptions } from "./SpriteLoader";
import SpriteLoader from "./SpriteLoader";
import type { GameMap, GameTile } from "./MapLoader";
import MapLoader from "./MapLoader";
enum AssetType {
  IMAGE,
  SPRITE,
  SPINE,
  SOUND,
  UI,
}
import RAPIER from "@dimforge/rapier2d-compat";
import { Persist } from "@/persist/persist";
import { PixiSpineLoader } from "./PixiSpineLoader";
import { UIConfig } from "@/ui/UiConfigs";
import { assignGlobalSingleton, setGlobalSingleton } from "@/global";
import * as PIXI from "pixi.js";
import { PixiSoundLoader, SoundOptions } from "./SoundLoader";
import { Sound } from "@pixi/sound";

const n = (name: string) => name?.toLowerCase().replace(/ /g, "_");

setGlobalSingleton("RAPIER", RAPIER);
setGlobalSingleton("PIXI", PIXI);

export default class AssetLoader {
  static getInstance(): AssetLoader {
    return assignGlobalSingleton("assetLoader", () => new AssetLoader());
  }

  private assetCache: {
    [key: string]: { type: AssetType; promise: Promise<string> };
  } = {};

  private uiCache: {
    [key: string]: UIConfig[];
  } = {};

  async load(): Promise<boolean> {
    const assetPromises = Object.values(this.assetCache).map((asset) => asset.promise);

    await Promise.all(assetPromises);
    await RAPIER.init();
    await Persist.getInstance().init();

    try {
      await SpriteLoader.getInstance().waitForAll();
    } catch (e) {
      console.error(e);
      throw e;
    }
    return true;
  }

  async loadUi(name: string, ui: UIConfig[]) {
    this.assetCache[n(name)] = {
      type: AssetType.UI,
      promise: Promise.resolve(n(name)),
    };
    this.uiCache[n(name)] = ui;
    return this.assetCache[n(name)].promise;
  }

  async loadImage(
    name: string,
    urlOrOptions?: string | Partial<ImageOptions>,
    options?: Partial<ImageOptions>
  ): Promise<string> {
    let url;
    if (typeof urlOrOptions === "string") {
      url = urlOrOptions;
    } else if (urlOrOptions) {
      options = urlOrOptions;
    }
    if (!url) {
      url = name + ".png";
    }
    const assetPath = `assets/images/${url}`;

    this.assetCache[n(name)] = {
      type: AssetType.IMAGE,
      promise: ImageLoader.getInstance()
        .loadImage(n(name), assetPath, options)
        .then(() => n(name)),
    };
    return this.assetCache[n(name)].promise;
  }

  async loadSprite(name: string, url: string, options: Partial<SpriteOptions>): Promise<string> {
    const assetPath = `assets/images/${url}`;
    this.assetCache[n(name)] = {
      type: AssetType.SPRITE,
      promise: SpriteLoader.getInstance()
        .loadSprite(n(name), assetPath, options)
        .then(() => n(name)),
    };
    return this.assetCache[n(name)].promise;
  }

  async loadSpine(name: string, url: string): Promise<string> {
    const assetPath = `assets/spine/${url}`;
    this.assetCache[n(name)] = {
      type: AssetType.SPINE,
      promise: PixiSpineLoader.getInstance()
        .loadSpine(n(name), assetPath)
        .then(() => n(name)),
    };
    return this.assetCache[n(name)].promise;
  }

  async loadMap(name: string, url: string): Promise<string> {
    const assetPath = `assets/maps/${url}`;
    this.assetCache[n(name)] = {
      type: AssetType.SPRITE,
      promise: MapLoader.getInstance()
        .loadMap(n(name), assetPath)
        .then(() => n(name)),
    };
    return this.assetCache[n(name)].promise;
  }

  async loadMapSkin(name: string, url: string): Promise<string> {
    const assetPath = `assets/maps/${url}`;
    this.assetCache[n(name)] = {
      type: AssetType.SPRITE,
      promise: MapLoader.getInstance()
        .loadSkin(n(name), assetPath)
        .then(() => n(name)),
    };
    return this.assetCache[n(name)].promise;
  }

  async loadSound(name: string, url: string, soundOptions?: SoundOptions): Promise<String> {
    const assetPath = `assets/sounds/${url}`;
    this.assetCache[n(name)] = {
      type: AssetType.SOUND,
      promise: PixiSoundLoader.getInstance()
        .loadSound(n(name), assetPath, soundOptions)
        .then(() => n(name)),
    };
    return this.assetCache[n(name)].promise;
  }

  getUi(name: string): UIConfig[] {
    return JSON.parse(JSON.stringify(this.uiCache[n(name)]));
  }

  getImage(name: string): ImageObj {
    return ImageLoader.getInstance().get(n(name));
  }

  getSprite(name: string, index?: number): Sprite[] | Sprite {
    return SpriteLoader.getInstance().get(n(name), index);
  }

  getSound(name: string): [Sound, SoundOptions] {
    return PixiSoundLoader.getInstance().get(n(name));
  }

  getMap(name: string): GameMap {
    return MapLoader.getInstance().get(n(name));
  }

  getMapSkin(name: string): {
    floor: {
      stamp: string;
      density: number;
      baseColor: string;
      stampColor: string;
    };
    tiles: { [key: string]: GameTile };
  } {
    return MapLoader.getInstance().getSkin(name);
  }
}
