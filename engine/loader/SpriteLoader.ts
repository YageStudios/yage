import ImageLoader from "./ImageLoader";
import type * as PIXI from "pixi.js";
import { PixiSpriteLoader } from "./PixiSpriteLoader";
import { assignGlobalSingleton } from "@/global";

export type SpriteStructure = {
  name: string | string[];
  frames: number;
  xoffset?: number;
  yoffset?: number;
};

export type SpriteOptions = {
  width: number;
  height: number;
  spacing: number;
  margin: number;
  xoffset?: number;
  yoffset?: number;
  frames?: number;
  aliases?: string[];
  structure?: SpriteStructure[];
  zIndex?: number;
};

export type Sprite = {
  name: string;
  image: HTMLImageElement;
  url: string;
  frameNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  next: Sprite | null;
  prev: Sprite | null;
  first: Sprite | null;
  last: Sprite | null;
  zIndex: number;
};

type SpritePromise = {
  url: string;
  promise: Promise<string>;
};

const defaultOptions: SpriteOptions = {
  width: 0,
  height: 0,
  spacing: 0,
  margin: 0,
  zIndex: 0,
};

export default class SpriteLoader {
  static getInstance(): SpriteLoader {
    return assignGlobalSingleton("SpriteLoader", () => new SpriteLoader());
  }

  private spriteCache: { [key: string]: Sprite[] | SpritePromise } = {};
  private promises: Promise<string>[] = [];
  private app: PIXI.Application | null = null;

  loadSprite(name: string, url: string, options?: Partial<SpriteOptions>): Promise<string> {
    if (this.spriteCache[name]) {
      let spriteUrl;
      if (Array.isArray(this.spriteCache[name])) {
        const first = (this.spriteCache[name] as Sprite[])[0] as Sprite;
        spriteUrl = first.url;
        if (spriteUrl !== url) {
          return Promise.reject(`Sprite ${name} already loaded with url ${spriteUrl}`);
        }
        return Promise.resolve(name);
      }
      spriteUrl = (this.spriteCache[name] as SpritePromise).url;
      if (spriteUrl !== url) {
        return Promise.reject(`Sprite ${name} already loaded with url ${spriteUrl}`);
      }
      return (this.spriteCache[name] as SpritePromise).promise;
    }
    const spriteOptions = {
      ...defaultOptions,
      ...(options ?? {}),
    } as SpriteOptions;

    // eslint-disable-next-line no-async-promise-executor
    const spritePromise = new Promise<string>(async (resolve, reject) => {
      try {
        const image = await ImageLoader.getInstance().loadImage(name, url, {
          skipPixi: true,
        });
        const imageWidth = image.image.width;
        const imageHeight = image.image.height;
        const spriteWidth = spriteOptions.width || imageWidth;
        const spriteHeight = spriteOptions.height || imageHeight;
        const spriteSpacing = spriteOptions.spacing;
        const spriteMargin = spriteOptions.margin;

        const sprites: Sprite[] = [];

        for (let y = 0; y < imageHeight; y += spriteHeight + spriteMargin) {
          for (let x = 0; x < imageWidth; x += spriteWidth + spriteSpacing) {
            sprites.push({
              image: image.image,
              name,
              url,
              frameNumber: sprites.length,
              x,
              y,
              width: spriteWidth,
              height: spriteHeight,
              next: null,
              prev: null,
              first: null,
              last: null,
              xoffset: spriteOptions.xoffset ?? 0,
              yoffset: spriteOptions.yoffset ?? 0,
              zIndex: spriteOptions.zIndex ?? 0,
            });
          }
        }

        const first = sprites[0];
        const last = sprites[sprites.length - 1];
        const subSpriteContainer: { [key: string]: Sprite[] } = {};
        sprites.forEach((sprite, index) => {
          if (index > 0) {
            sprite.prev = sprites[index - 1];
            sprites[index - 1].next = sprite;
          }
          if (index === 0) {
            sprite.first = first;
            sprite.last = last;
          }
          if (index === sprites.length - 1) {
            sprite.first = first;
            sprite.last = last;
          }
        });

        if (spriteOptions.structure) {
          const aliases = spriteOptions.aliases ?? [""];
          let offset = 0;
          aliases.forEach((alias) => {
            const aliasName = alias ? alias : name;
            // let aliasName = alias ? `${name}_${alias}` : name;
            if (!spriteOptions.structure) {
              return;
            }
            spriteOptions.structure.forEach((structure) => {
              const structureNames = Array.isArray(structure.name) ? structure.name : [structure.name];
              let suboffset = 0;
              structureNames.forEach((subName) => {
                const subSprites: Sprite[] = [];
                const structureName = `${aliasName}_${subName}`;
                for (let i = 0; i < sprites.length; i++) {
                  const sprite = { ...sprites[offset + i] };
                  sprite.name = structureName;
                  sprite.xoffset = structure.xoffset ?? sprite.xoffset;
                  sprite.yoffset = structure.yoffset ?? sprite.yoffset;
                  subSprites.push(sprite);
                  if (subSprites.length === structure.frames) {
                    break;
                  }
                }
                subSprites[0].first = null;
                subSprites[subSprites.length - 1].last = null;

                this.spriteCache[structureName] = subSprites;
                subSpriteContainer[structureName] = subSprites;
                if (suboffset === 0) {
                  suboffset += structure.frames;
                }
              });
              offset += suboffset;
            });
          });
        }

        this.spriteCache[name] = sprites;
        await PixiSpriteLoader.getInstance().loadSprite(name, url, sprites, subSpriteContainer);
        resolve(name);
      } catch (error) {
        reject(error);
      }
    });

    this.spriteCache[name] = { url, promise: spritePromise };
    this.promises.push(spritePromise);

    return spritePromise;
  }

  waitForAll(): Promise<true> {
    return Promise.all(this.promises).then(() => {
      this.promises = [];
      return true;
    });
  }

  get(name: string, index?: number): Sprite[] | Sprite {
    if (this.promises.length) {
      throw new Error("Sprites not loaded");
    }
    if (!this.spriteCache[name]) {
      throw new Error(`Sprite ${name} not loaded`);
    }
    if (index !== undefined) {
      return (this.spriteCache[name] as Sprite[])[index];
    }
    return this.spriteCache[name] as Sprite[];
  }
}
