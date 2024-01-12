import { assignGlobalSingleton } from "@/global";
import * as PIXI from "pixi.js";

export type ImageOptions = {
  xoffset: number;
  yoffset: number;
  width: number;
  height: number;
  animationSpeed: number;
  initialRotation: number;
  skipPixi: boolean;
  zIndex: number;
};

const defaultOptions: ImageOptions = {
  xoffset: 0,
  yoffset: 0,
  width: 16,
  height: 22,
  animationSpeed: 1,
  initialRotation: 0,
  skipPixi: false,
  zIndex: 2,
};
const n = (name: string) => name?.toLowerCase().replace(/ /g, "_");

export type ImageObj = ImageOptions & {
  name: string;
  image: HTMLImageElement;
  url: string;
  promise: Promise<ImageObj> | null;
};

export default class ImageLoader {
  static getInstance(): ImageLoader {
    return assignGlobalSingleton("ImageLoaderInstance", () => new ImageLoader());
  }

  private imageCache: { [key: string]: ImageObj } = {};
  private promises: Promise<ImageObj>[] = [];

  loadImage(name: string, url: string, imageOptions?: Partial<ImageOptions>): Promise<ImageObj> {
    if (typeof window === "undefined") {
      // @ts-ignore
      return Promise.resolve({
        name: n(name),
        url,
        image: null,
        promise: null,
        ...defaultOptions,
        ...imageOptions,
      });
    }
    const loadPromise = new Promise<ImageObj>((resolve, reject) => {
      if (this.imageCache[n(name)]) {
        return this.imageCache[n(name)].promise?.then(() => {
          resolve(this.imageCache[n(name)]);
        });
      }
      const image = new Image();
      image.src = url;
      this.imageCache[n(name)] = {
        image,
        name: n(name),
        url,
        ...defaultOptions,
        ...(imageOptions ?? {}),
        promise: null,
      };
      image.onload = async () => {
        if (this.imageCache[n(name)].width === -1) {
          this.imageCache[n(name)].width = image.width;
        }
        if (this.imageCache[n(name)].height === -1) {
          this.imageCache[n(name)].height = image.height;
        }
        if (!this.imageCache[n(name)].skipPixi) {
          this.pixiAssetCache[n(name)] = (await PIXI.Assets.load(url)) as PIXI.Texture;
        }
        resolve(this.imageCache[n(name)]);
      };
      image.onerror = () => reject(image);
    });
    this.imageCache[n(name)].promise = loadPromise;
    this.promises.push(loadPromise);
    loadPromise.then(() => {
      this.promises = this.promises.filter((p) => p !== loadPromise);
    });
    return loadPromise;
  }

  private pixiAssetCache: {
    [key: string]: PIXI.Texture;
  } = {};

  public getPixiTexture(name: string): PIXI.Texture {
    return this.pixiAssetCache[n(name)];
  }

  get(name: string): ImageObj {
    if (this.promises.length) {
      throw new Error("Images not loaded");
    }
    if (!this.imageCache[n(name)]) {
      throw new Error(`Image ${n(name)} not found`);
    }
    return this.imageCache[n(name)];
  }
}
