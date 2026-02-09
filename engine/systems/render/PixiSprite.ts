/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { rotateDegVector2d, rotationVector2d } from "../../utils/vector";
import { FaceDirectionEnum } from "../../constants/enums";
import type { Sprite } from "yage/loader/SpriteLoader";
import SpriteLoader from "yage/loader/SpriteLoader";
import * as PIXI from "pixi.js";
import { PixiSpriteLoader } from "../../loader/PixiSpriteLoader";
import ImageLoader from "../../loader/ImageLoader";
import { Attach } from "yage/schemas/entity/Attach";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { Radius } from "yage/schemas/entity/Radius";
import { Transform } from "yage/schemas/entity/Transform";
import { PixiSprite } from "yage/schemas/render/PixiSprite";
import type { Viewport } from "pixi-viewport";
import { DrawSystemImpl, System, getSystem } from "minecs";
import type { ReadOnlyGameModel } from "yage/game/GameModel";
import { PixiViewportSystem } from "./PixiViewport";
import { SpatialHash2d } from "yage/utils/SpatialHash2d";

export type PixiSpriteContainer = {
  sprite: PIXI.Sprite;
  spriteKey: string;
  container: PIXI.Container;
  debug?: PIXI.Container;
  lastFlip: number;
};

@System(Transform, PixiSprite)
export class SpriteComponentPixi extends DrawSystemImpl<ReadOnlyGameModel> {
  ids: Set<number> = new Set();

  instances: {
    [id: number]: PixiSpriteContainer;
  } = {};
  animationCache: { [id: string]: (PIXI.Sprite | PIXI.AnimatedSprite)[] } = {};
  imageCache: { [id: string]: PIXI.Sprite[] } = {};

  private _cachedViewY = 0;
  private _cachedViewYTime = -1;
  private static readonly CULL_X = 2200;
  private static readonly CULL_Y = 1300;
  private static readonly HASH_CELL_SIZE = 256;
  private static readonly CULL_PADDING = 256;
  private _tmpDirection = { x: 0, y: 0 };
  private _spatialHash = new SpatialHash2d(SpriteComponentPixi.HASH_CELL_SIZE);
  private _indexed = new Set<number>();
  private _lastVisible = new Set<number>();

  private getViewBounds(viewport: Viewport) {
    const topLeft = viewport.toWorld(0, 0);
    const bottomRight = viewport.toWorld(viewport.screenWidth, viewport.screenHeight);
    return {
      minX: Math.min(topLeft.x, bottomRight.x) - SpriteComponentPixi.CULL_PADDING,
      minY: Math.min(topLeft.y, bottomRight.y) - SpriteComponentPixi.CULL_PADDING,
      maxX: Math.max(topLeft.x, bottomRight.x) + SpriteComponentPixi.CULL_PADDING,
      maxY: Math.max(topLeft.y, bottomRight.y) + SpriteComponentPixi.CULL_PADDING,
    };
  }

  transform(
    pixiData: PixiSpriteContainer,
    entity: number,
    data: PixiSprite,
    renderModel: ReadOnlyGameModel,
    viewport: Viewport,
  ) {
    const { sprite, container } = pixiData;
    const horizontalDistanceFromCenter = Math.abs(container.x - viewport.center.x);
    const verticalDistanceFromCenter = Math.abs(container.y - viewport.center.y);
    if (horizontalDistanceFromCenter > SpriteComponentPixi.CULL_X || verticalDistanceFromCenter > SpriteComponentPixi.CULL_Y) {
      container.visible = false;
      return;
    }
    container.visible = true;

    const locomotion = renderModel.getTypedUnsafe(Locomotion, entity);
    const direction = this._tmpDirection;
    direction.x = locomotion.directionX;
    direction.y = locomotion.directionY;
    if (sprite.anchor.x !== data.anchorX || sprite.anchor.y !== data.anchorY) {
      sprite.anchor.set(data.anchorX, data.anchorY);
    }
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
      if (!data.rotation && renderModel.hasComponent(Attach, entity)) {
        const owner = renderModel.getTypedUnsafe(Attach, entity).parent!;
        xDirection = renderModel(Locomotion).store.directionX[owner];
      }

      if (!data.antiJitterTime || renderModel.timeElapsed - pixiData.lastFlip > data.antiJitterTime) {
        if (xDirection < 0) {
          sprite.scale.x = -1;
        } else {
          sprite.scale.x = 1;
        }
        pixiData.lastFlip = renderModel.timeElapsed;
      }
    } else if (data.rotation) {
      const angle = (data.rotation * Math.PI) / 180;

      sprite.rotation = angle;
    } else if (data.faceDirection === FaceDirectionEnum.HORIZONTAL) {
      let xDirection = direction.x;
      if (renderModel.hasComponent(Attach, entity)) {
        const owner = renderModel.getTypedUnsafe(Attach, entity).parent!;
        xDirection = renderModel(Locomotion).store.directionX[owner];
      }

      if (!data.antiJitterTime || renderModel.timeElapsed - pixiData.lastFlip > data.antiJitterTime) {
        if (xDirection < 0) {
          sprite.scale.x = -1;
        } else {
          sprite.scale.x = 1;
        }
        pixiData.lastFlip = renderModel.timeElapsed;
      }
    } else if (data.faceDirection === FaceDirectionEnum.VERTICAL) {
      if (!data.antiJitterTime || renderModel.timeElapsed - pixiData.lastFlip > data.antiJitterTime) {
        container.scale.y = direction.y < 0 ? -1 * data.scale : 1 * data.scale;
        pixiData.lastFlip = renderModel.timeElapsed;
      }
    }
    if (container.scale.x !== data.scale) {
      container.scale.set(data.scale);
    }
  }

  init = (renderModel: ReadOnlyGameModel, entity: number) => {
    const viewport = getSystem(renderModel, PixiViewportSystem).viewport;

    const spriteData = renderModel.getTypedUnsafe(PixiSprite, entity);
    let zIndex = 2;

    const instance: Partial<PixiSpriteContainer> = {
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

    this.instances[entity] = instance as PixiSpriteContainer;
    viewport.addChild(instance.container!);
    this.ids.add(entity);
  };

  runAll = (renderModel: ReadOnlyGameModel) => {
    const viewport = getSystem(renderModel, PixiViewportSystem).viewport;
    const entities = this.query(renderModel);
    const activeSet = new Set<number>(entities);

    for (const indexedEntity of this._indexed) {
      if (!activeSet.has(indexedEntity)) {
        this._spatialHash.remove(indexedEntity);
        this._indexed.delete(indexedEntity);
        this._lastVisible.delete(indexedEntity);
      }
    }

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const transform = renderModel(Transform, entity);
      const x = transform.x;
      const y = transform.y - transform.z;
      if (this._indexed.has(entity)) {
        this._spatialHash.update(entity, x, y);
      } else {
        this._spatialHash.insert(entity, x, y);
        this._indexed.add(entity);
      }
    }

    const bounds = this.getViewBounds(viewport);
    const candidates = this._spatialHash.query(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    const visibleNow = new Set<number>();

    for (let i = 0; i < candidates.length; i++) {
      const entity = candidates[i];
      if (!activeSet.has(entity)) {
        continue;
      }
      visibleNow.add(entity);
      this.runEntity(renderModel, entity, viewport);
    }

    for (const entity of this._lastVisible) {
      if (!visibleNow.has(entity)) {
        const instanceData = this.instances[entity];
        if (instanceData) {
          instanceData.container.visible = false;
        }
      }
    }
    this._lastVisible = visibleNow;
  };

  run = (renderModel: ReadOnlyGameModel, entity: number) => {
    const viewport = getSystem(renderModel, PixiViewportSystem).viewport;
    this.runEntity(renderModel, entity, viewport);
  };

  private runEntity = (renderModel: ReadOnlyGameModel, entity: number, viewport: Viewport) => {
    const spriteData = renderModel.getTypedUnsafe(PixiSprite, entity);

    if (
      this.instances[entity] &&
      (spriteData.currentAnimation ?? spriteData.imageKey ?? spriteData.spriteKey) !== this.instances[entity].spriteKey
    ) {
      this.cleanup(renderModel, entity);
    }

    if (!this.instances[entity]) {
      this.init(renderModel, entity);
    }
    const pixiData = this.instances[entity];
    const { sprite, container, debug } = pixiData;

    if (spriteData.opacity === 0) {
      sprite.visible = false;
    } else {
      sprite.visible = true;
      sprite.alpha = spriteData.opacity ?? 1;
    }

    const transform = renderModel(Transform, entity);
    const positionX = transform.x;
    const positionY = transform.y - transform.z;

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
    if (this._cachedViewYTime !== renderModel.timeElapsed) {
      this._cachedViewY = viewport.toWorld(0, 0).y;
      this._cachedViewYTime = renderModel.timeElapsed;
    }
    const viewY = this._cachedViewY;

    if (spriteData.inheritParentZIndex && renderModel.hasComponent(Attach, entity)) {
      const owner = renderModel.getTypedUnsafe(Attach, entity).parent!;
      const ownerTransform = renderModel.getTypedUnsafe(Transform, owner);
      const ownerRadius = renderModel.getTypedUnsafe(Radius, owner)?.radius ?? 0;
      container.zIndex = ownerTransform.y - viewY + ownerTransform.z + ownerRadius + spriteData.zIndex;
    } else if (spriteData.relativeZIndex) {
      // const mapStripe = Transform.store.y[entity] / 320;
      const radius = renderModel(Radius).store.radius[entity] ?? 0;
      container.zIndex = transform.y - viewY + transform.z + radius + spriteData.zIndex;
    } else {
      container.zIndex = spriteData.zIndex;
    }

    container.x = positionX + xoffset;
    container.y = positionY + yoffset;

    debug?.position.set(positionX, positionY);

    this.transform(pixiData, entity, spriteData, renderModel, viewport);
  };

  cleanup = (renderModel: ReadOnlyGameModel, entity: number) => {
    this._spatialHash.remove(entity);
    this._indexed.delete(entity);
    this._lastVisible.delete(entity);

    const instanceData = this.instances[entity];
    if (!instanceData) {
      return;
    }
    instanceData.container.destroy();
    const instance = this.instances[entity].sprite;
    delete this.instances[entity];
    instance.visible = false;
    const spriteData = renderModel.getTypedUnsafe(PixiSprite, entity);
    if (spriteData.spriteKey) {
      const key = instanceData.spriteKey;
      this.animationCache[key] = this.animationCache[key] ?? [];
      this.animationCache[key].push(instance);
    } else {
      this.imageCache[instanceData.spriteKey] = this.imageCache[instanceData.spriteKey] ?? [];
      this.imageCache[instanceData.spriteKey].push(instance);
    }
    this.ids.delete(entity);
  };
}
