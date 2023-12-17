/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { rotateDegVector2d, rotationVector2d } from "../../utils/vector";
import { ComponentCategory } from "../types";
import { DEPTHS, registerPixiComponent, registerSystem } from "@/components/ComponentRegistry";
import { FaceDirectionEnum } from "../../constants/enums";
import type { GameModel } from "@/game/GameModel";
import type { Sprite } from "@/loader/SpriteLoader";
import SpriteLoader from "@/loader/SpriteLoader";
import type { System } from "../System";
import type { PixiDrawSystem } from "../PixiDrawSystem";
import * as PIXI from "pixi.js";
import { PixiSpriteLoader } from "../../loader/PixiSpriteLoader";
import ImageLoader from "../../loader/ImageLoader";
import { ChildSchema } from "@/schemas/entity/Child";
import { LocomotionSchema } from "@/schemas/entity/Locomotion";
import { RadiusSchema } from "@/schemas/entity/Radius";
import { TransformSchema } from "@/schemas/entity/Transform";
import { SpriteSchema } from "@/schemas/render/Sprite";
import { Viewport } from "pixi-viewport";

export type PixiSpriteSchema = {
  sprite: PIXI.Sprite;
  spriteKey: string;
  container: PIXI.Container;
  debug?: PIXI.Container;
  lastFlip: number;
};

export class SpriteComponentPixi implements PixiDrawSystem {
  ids: Set<number> = new Set();
  schema = SpriteSchema;

  instances: {
    [id: number]: PixiSpriteSchema;
  } = {};
  animationCache: { [id: string]: (PIXI.Sprite | PIXI.AnimatedSprite)[] } = {};
  imageCache: { [id: string]: PIXI.Sprite[] } = {};

  transform(pixiData: PixiSpriteSchema, entity: number, data: SpriteSchema, gameModel: GameModel, viewport: Viewport) {
    const { sprite, container } = pixiData;
    const locomotionSchema = gameModel.getTyped(entity, LocomotionSchema);
    const direction = { x: locomotionSchema.directionX, y: locomotionSchema.directionY };
    sprite.anchor.set(data.anchorX, data.anchorY);
    if (data.faceDirection === FaceDirectionEnum.ROTATE) {
      const angle = data.rotation
        ? rotationVector2d(rotateDegVector2d(direction, data.rotation))
        : rotationVector2d(direction);

      sprite.rotation = angle;
    } else if (data.faceDirection === FaceDirectionEnum.HORIZONTAL_ROTATE) {
      const angle = data.rotation
        ? rotationVector2d(rotateDegVector2d(direction, data.rotation))
        : rotationVector2d(direction);

      sprite.rotation = angle;

      let xDirection = direction.x;
      if (!data.rotation && gameModel.hasComponent(entity, ChildSchema)) {
        const owner = gameModel.getComponent(entity, ChildSchema).parent;
        xDirection = LocomotionSchema.store.directionX[owner];
      }

      if (!data.antiJitterTime || gameModel.timeElapsed - pixiData.lastFlip > data.antiJitterTime) {
        if (xDirection < 0) {
          sprite.scale.x = -1;
          // sprite.rotation = -angle;
        } else {
          sprite.scale.x = 1;
        }
        pixiData.lastFlip = gameModel.timeElapsed;
      }
    } else if (data.rotation) {
      const angle = (data.rotation * Math.PI) / 180;

      sprite.rotation = angle;
    } else if (data.faceDirection === FaceDirectionEnum.HORIZONTAL) {
      let xDirection = direction.x;
      if (gameModel.hasComponent(entity, ChildSchema)) {
        const owner = gameModel.getComponent(entity, ChildSchema).parent;
        xDirection = LocomotionSchema.store.directionX[owner];
      }

      if (!data.antiJitterTime || gameModel.timeElapsed - pixiData.lastFlip > data.antiJitterTime) {
        if (xDirection < 0) {
          sprite.scale.x = -1;
        } else {
          sprite.scale.x = 1;
        }
        pixiData.lastFlip = gameModel.timeElapsed;
      }
    } else if (data.faceDirection === FaceDirectionEnum.VERTICAL) {
      if (!data.antiJitterTime || gameModel.timeElapsed - pixiData.lastFlip > data.antiJitterTime) {
        container.scale.y = direction.y < 0 ? -1 * data.scale : 1 * data.scale;
        pixiData.lastFlip = gameModel.timeElapsed;
      }
    }
    if (container.scale.x !== data.scale) {
      container.scale.set(data.scale);
    }

    const verticalDistanceFromCenter = Math.abs(pixiData.container.y - viewport.center.y);
    const horizontalDistanceFromCenter = Math.abs(pixiData.container.x - viewport.center.x);
    if (
      horizontalDistanceFromCenter - pixiData.container.width / 2 > 1920 ||
      verticalDistanceFromCenter - pixiData.container.height / 2 > 1080
    ) {
      container.visible = false;
    } else {
      container.visible = true;
    }
  }

  init(entity: number, gameModel: GameModel, viewport: Viewport) {
    const spriteData = gameModel.getTyped(entity, this.schema);
    let zIndex = 2;

    const instance: Partial<PixiSpriteSchema> = {
      container: this.instances[entity]?.container ?? new PIXI.Container(),
      debug: this.instances[entity]?.debug,
      lastFlip: 0,
    };

    if (!instance.debug) {
      instance.debug = new PIXI.Container();
      instance.debug.visible = false;
      viewport.addChild(instance.debug);
    }

    if (spriteData.spriteKey && spriteData.currentAnimation) {
      let sprite: PIXI.AnimatedSprite;
      if (!this.animationCache[spriteData.currentAnimation]?.length) {
        const t = PixiSpriteLoader.getInstance().pixiSpriteLibrary.get(spriteData.spriteKey) as PIXI.Spritesheet<any>;

        sprite = new PIXI.AnimatedSprite(t!.animations[spriteData.currentAnimation]);
      } else {
        sprite = this.animationCache[spriteData.currentAnimation].pop()! as PIXI.AnimatedSprite;
        sprite.visible = true;
      }

      const spriteLoaderData = (SpriteLoader.getInstance().get(spriteData.spriteKey) as Sprite[])[0]!;

      sprite.animationSpeed = spriteData.animationSpeed || 0.125;
      zIndex = spriteData.zIndex || spriteLoaderData.zIndex || 2;
      sprite.gotoAndPlay(spriteData.animationIndex ?? 0);

      instance.container!.addChild(sprite);

      instance.sprite = sprite;
      instance.spriteKey = spriteData.currentAnimation;
    } else if (spriteData.imageKey) {
      let image: PIXI.Sprite;
      if (!this.imageCache[spriteData.imageKey]?.length) {
        const imageTexture = ImageLoader.getInstance().getPixiTexture(spriteData.imageKey);
        image = new PIXI.Sprite(imageTexture);
      } else {
        image = this.imageCache[spriteData.imageKey].pop()!;
        image.visible = true;
      }
      const imageLoaderData = ImageLoader.getInstance().get(spriteData.imageKey);

      instance.container!.addChild(image);
      zIndex = spriteData.zIndex || imageLoaderData.zIndex || 2;

      instance.sprite = image;
      instance.spriteKey = spriteData.imageKey;
    } else {
      let sprite: PIXI.AnimatedSprite;
      if (!this.animationCache[spriteData.spriteKey]?.length) {
        const t = PixiSpriteLoader.getInstance().pixiSpriteLibrary.get(spriteData.spriteKey) as PIXI.Spritesheet<any>;
        sprite = new PIXI.AnimatedSprite(t!.animations[spriteData.spriteKey]);
      } else {
        sprite = this.animationCache[spriteData.spriteKey].pop()! as PIXI.AnimatedSprite;
        sprite.visible = true;
      }
      const spriteLoaderData = (SpriteLoader.getInstance().get(spriteData.spriteKey) as Sprite[])[0]!;

      sprite.animationSpeed = 0.125;
      zIndex = spriteData.zIndex || spriteLoaderData.zIndex || 2;

      sprite.gotoAndStop(spriteData.frame);
      instance.container!.addChild(sprite);

      instance.sprite = sprite;
      instance.spriteKey = spriteData.spriteKey;
    }
    instance.container!.zIndex = zIndex;
    instance.sprite.position.set(0, 0);
    instance.container?.scale.set(spriteData.scale);

    this.instances[entity] = instance as PixiSpriteSchema;
    viewport.addChild(instance.container!);
    this.ids.add(entity);
  }

  run(entity: number, gameModel: GameModel, viewport: Viewport) {
    const spriteData = gameModel.getTyped(entity, this.schema);

    if (
      this.instances[entity] &&
      (spriteData.currentAnimation ?? spriteData.imageKey ?? spriteData.spriteKey) !== this.instances[entity].spriteKey
    ) {
      this.cleanup(entity, gameModel);
    }

    if (!this.instances[entity]) {
      this.init(entity, gameModel, viewport);
    }
    const pixiData = this.instances[entity];
    const { sprite, container, debug } = pixiData;

    if (spriteData.opacity === 0) {
      sprite.visible = false;
    } else {
      sprite.visible = true;
      sprite.alpha = spriteData.opacity ?? 1;
    }
    const transformSchema = gameModel.getTyped(entity, TransformSchema);

    const position = transformSchema.position;

    position.y -= transformSchema.z;

    let xoffset = 0;
    let yoffset = 0;

    if (spriteData.imageKey) {
      const imageLoaderData = ImageLoader.getInstance().get(spriteData.imageKey);
      xoffset = spriteData.xoffset ?? imageLoaderData.xoffset;
      yoffset = spriteData.yoffset ?? imageLoaderData.yoffset;
    } else {
      const spriteLoaderData = (SpriteLoader.getInstance().get(spriteData.spriteKey) as Sprite[])[0]!;
      xoffset = spriteData.xoffset ?? spriteLoaderData.xoffset;
      yoffset = spriteData.yoffset ?? spriteLoaderData.yoffset;

      if (!spriteData.currentAnimation) {
        const animatedSprite = sprite as PIXI.AnimatedSprite;
        if (animatedSprite.currentFrame !== spriteData.frame) {
          animatedSprite.gotoAndStop(spriteData.frame);
        }
      }
    }
    const viewY = viewport.position.y;

    if (gameModel.hasComponent(entity, ChildSchema)) {
      const owner = gameModel.getComponent(entity, ChildSchema).parent;
      container.zIndex =
        TransformSchema.store.y[owner] -
        viewY +
        TransformSchema.store.z[owner] +
        RadiusSchema.store.radius[owner] +
        spriteData.zIndex;
    } else {
      // const mapStripe = TransformSchema.store.y[entity] / 320;
      container.zIndex =
        TransformSchema.store.y[entity] -
        viewY +
        TransformSchema.store.z[entity] +
        RadiusSchema.store.radius[entity] +
        spriteData.zIndex;
    }

    container.x = position.x + xoffset;
    container.y = position.y + yoffset;

    debug?.position.set(position.x, position.y);

    this.transform(pixiData, entity, spriteData, gameModel, viewport);
  }

  cleanup(entity: number, gameModel: GameModel) {
    const instanceData = this.instances[entity];
    if (!instanceData) {
      return;
    }
    instanceData.container.destroy();
    const instance = this.instances[entity].sprite;
    delete this.instances[entity];
    instance.visible = false;
    const spriteData = gameModel.getTyped(entity, this.schema);
    if (spriteData.spriteKey) {
      const key = instanceData.spriteKey;
      this.animationCache[key] = this.animationCache[key] ?? [];
      this.animationCache[key].push(instance);
    } else {
      this.imageCache[instanceData.spriteKey] = this.imageCache[instanceData.spriteKey] ?? [];
      this.imageCache[instanceData.spriteKey].push(instance);
    }
    this.ids.delete(entity);
  }
}

registerPixiComponent("Sprite", SpriteComponentPixi);
