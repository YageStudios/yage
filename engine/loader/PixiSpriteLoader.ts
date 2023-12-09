import * as PIXI from "pixi.js";
import type { SpriteAnimationDefinition, SpriteDefinition } from "./PixiSprite";
import type { Sprite, SpriteOptions } from "./SpriteLoader";
import { assignGlobalSingleton } from "@/global";

export class PixiSpriteLoader {
  async loadSprite(name: string, assetPath: string, sprites: Sprite[], subSprites?: { [key: string]: Sprite[] }) {
    if (!sprites[0]?.image) {
      console.error(name, assetPath, sprites, subSprites);
    }
    const image = sprites[0].image;

    const spriteData = {
      frames: {},
      meta: {
        image: assetPath,
        format: "RGBA8888",
        size: { w: image.width, h: image.height },
        scale: "1",
      },
      animations: {
        [name]: sprites.map((sprite) => sprite.name + "_" + sprite.frameNumber), //array of frames by name
      },
    };
    sprites.forEach((sprite) => {
      // @ts-ignore
      spriteData.frames[sprite.name + "_" + sprite.frameNumber] = {
        frame: { x: sprite.x, y: sprite.y, w: sprite.width, h: sprite.height },
        sourceSize: { w: sprite.width, h: sprite.height },
        spriteSourceSize: { x: 0, y: 0, w: sprite.width, h: sprite.height },
      };
    });
    if (subSprites) {
      Object.keys(subSprites).forEach((key) => {
        spriteData.animations[key] = subSprites[key].map((sprite) => {
          return name + "_" + sprite.frameNumber;
        });
      });
    }

    const spritesheet = new PIXI.Spritesheet(
      PIXI.BaseTexture.from(spriteData.meta.image),
      spriteData
    ) as PIXI.Spritesheet<any>;
    await spritesheet.parse();
    Object.entries(spriteData.animations).forEach(([key, value]) => {
      spritesheet.animations[key] = value.map((animation: string) => {
        return spritesheet.textures[animation];
      });
    });

    this.pixiSpriteLibrary.set(name, spritesheet);
  }

  async preloadSpriteFromOptions(name: string, path: string, options: Partial<SpriteOptions>) {
    const spriteDefinition = this.spriteOptionsToDefinition(options, path, name);
    const spriteSheet = this.preloadSprite(spriteDefinition);
    const animations = await spriteSheet.parse();
    this.pixiSpriteLibrary.set(name, spriteSheet);
  }

  pixiSpriteLibrary = new Map<string, PIXI.Spritesheet>();

  spriteOptionsToDefinition(options: Partial<SpriteOptions>, path: string, name: string): SpriteDefinition {
    const spriteTexture = PIXI.BaseTexture.from(path);
    const animations: SpriteAnimationDefinition[] = [];
    if (options.structure !== undefined) {
      const aliases = options.aliases ?? [name];
      const structure = options.structure;
      aliases.forEach((alias, aliasIdx) => {
        let startFrame = 0;

        structure.forEach((structure) => {
          const structureNames = Array.isArray(structure.name) ? structure.name : [structure.name];
          const animationNames = structureNames.map((structureName) => `${alias}_${structureName}`);
          const animationDefinitions = animationNames.map<SpriteAnimationDefinition>((animationName) => {
            console.log(
              `${animationName} start ${startFrame} width ${options.width} = ${startFrame * (options.width ?? 1)}`
            );
            const clonePartial = {
              name: animationName,
              startPos: {
                x: startFrame * (options.width ?? 32),
                y: aliasIdx * (options.height ?? 32),
              },
              numFrames: structure.frames,
            };
            clonePartial.name = animationName;
            return clonePartial;
          });
          startFrame += structure.frames;

          animations.push(...animationDefinitions);
        });
      });
    }

    const t = {
      imageName: path,
      spriteName: name,
      imageSize: {
        x: spriteTexture.width,
        y: spriteTexture.height,
      },
      spriteSize: {
        x: options.width ?? spriteTexture.width,
        y: options.height ?? spriteTexture.height,
      },
      sourcePos: {
        x: options.margin ?? 0,
        y: options.margin ?? 0,
      },
      animations,
      frameRate: 0.0005,
      offsets: { x: 0, y: 0 },
    };
    return t;
  }

  static getInstance() {
    return assignGlobalSingleton("PixiSpriteLoader", () => new PixiSpriteLoader());
  }
  spriteLibrary = new Map<string, PIXI.Spritesheet>();

  private getFramesForAnimations(definition: SpriteDefinition): {
    frames: { [key: string]: any };
    animations: { [key: string]: string[] };
  } {
    const frames: { [key: string]: any } = {};
    const animationsList: { [key: string]: string[] } = {};
    for (let i = 0; i < definition.animations.length; i++) {
      animationsList[definition.animations[i].name] = [];
      for (let j = 0; j < definition.animations[i].numFrames; j++) {
        const animationName = definition.animations[i].name;
        animationsList[animationName].push(this.getAnimationFrameName(animationName, j));
        const frame = this.getFrameFromAnimation(j, definition, definition.animations[i]);
        Object.assign(frames, frame);
      }
    }

    return {
      frames,
      animations: animationsList,
    };
  }

  preloadSprite(definition: SpriteDefinition): PIXI.Spritesheet {
    const animationData = this.getFramesForAnimations(definition);
    const meta = this.getMetaFromDefinition(definition);

    const atlasData = {
      ...animationData,
      ...meta,
    };

    const spritesheet = new PIXI.Spritesheet(PIXI.BaseTexture.from(atlasData.meta.image), atlasData);

    return spritesheet;
  }

  private getStaticFrame = (definition: SpriteDefinition) => ({
    default: {
      frame: {
        x: definition.sourcePos.x,
        y: definition.sourcePos.y,
        w: definition.spriteSize.x,
        h: definition.spriteSize.y,
      },
    },
  });

  private getAnimationFrameName = (animationName: string, idx: number) => `${animationName}_${idx}`;

  private getMetaFromDefinition = (definition: SpriteDefinition) => ({
    meta: {
      image: definition.imageName,
      format: "RGBA8888",
      size: { w: definition.imageSize.x, h: definition.imageSize.y },
      scale: definition.scale ?? "1",
    },
  });

  private getFrameFromAnimation(idx: number, definition: SpriteDefinition, animation: SpriteAnimationDefinition) {
    const { spriteSize, sourcePos, offsets } = definition;
    return {
      [`${this.getAnimationFrameName(animation.name, idx)}`]: {
        frame: {
          x: this.getAnimationPos(idx, sourcePos.x, spriteSize.x, offsets?.x || 0),
          y: sourcePos.y,
          w: spriteSize.x,
          h: spriteSize.y,
        },
        spriteSourceSize: { x: 0, y: 0, w: spriteSize.x, h: spriteSize.y },
        spriteSize: { w: spriteSize.x, h: spriteSize.y },
      },
    };
  }

  private getAnimationPos = (idx: number, sourcePos: number, spriteSize: number, offset: number) =>
    sourcePos + idx * spriteSize + idx * offset;
}
