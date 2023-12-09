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
import { assignGlobalSingleton } from "@/global";

export default class AssetLoader {
  static getInstance() {
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
    this.assetCache[name] = {
      type: AssetType.UI,
      promise: Promise.resolve(name),
    };
    this.uiCache[name] = ui;
    return this.assetCache[name].promise;
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

    this.assetCache[name] = {
      type: AssetType.IMAGE,
      promise: ImageLoader.getInstance()
        .loadImage(name, assetPath, options)
        .then(() => name),
    };
    return this.assetCache[name].promise;
  }

  async loadSprite(name: string, url: string, options: Partial<SpriteOptions>): Promise<string> {
    const assetPath = `assets/images/${url}`;
    this.assetCache[name] = {
      type: AssetType.SPRITE,
      promise: SpriteLoader.getInstance()
        .loadSprite(name, assetPath, options)
        .then(() => name),
    };
    return this.assetCache[name].promise;
  }

  async loadSpine(name: string, url: string): Promise<string> {
    const assetPath = `assets/spine/${url}`;
    this.assetCache[name] = {
      type: AssetType.SPINE,
      promise: PixiSpineLoader.getInstance()
        .loadSpine(name, assetPath)
        .then(() => name),
    };
    return this.assetCache[name].promise;
  }

  async loadMap(name: string, url: string): Promise<string> {
    const assetPath = `assets/maps/${url}`;
    this.assetCache[name] = {
      type: AssetType.SPRITE,
      promise: MapLoader.getInstance()
        .loadMap(name, assetPath)
        .then(() => name),
    };
    return this.assetCache[name].promise;
  }

  async loadMapSkin(name: string, url: string): Promise<string> {
    const assetPath = `assets/maps/${url}`;
    this.assetCache[name] = {
      type: AssetType.SPRITE,
      promise: MapLoader.getInstance()
        .loadSkin(name, assetPath)
        .then(() => name),
    };
    return this.assetCache[name].promise;
  }

  getUi(name: string): UIConfig[] {
    return JSON.parse(JSON.stringify(this.uiCache[name]));
  }

  getImage(name: string): ImageObj {
    return ImageLoader.getInstance().get(name);
  }

  getSprite(name: string, index?: number): Sprite[] | Sprite {
    return SpriteLoader.getInstance().get(name, index);
  }

  getMap(name: string): GameMap {
    return MapLoader.getInstance().get(name);
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
