/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { rotateDegVector2d, rotationVector2d } from "../../utils/vector";
import { ComponentCategory } from "../types";
import { DEPTHS, registerPixiComponent, registerSystem } from "@/components/ComponentRegistry";
import { FaceDirectionEnum } from "../../constants/enums";
import type { GameModel } from "@/game/GameModel";
import type { System } from "../System";
import type { PixiDrawSystem } from "../PixiDrawSystem";
import * as PIXI from "pixi.js";
import { PixiSpineLoader } from "../../loader/PixiSpineLoader";
import ImageLoader from "../../loader/ImageLoader";
import { ChildSchema } from "@/schemas/entity/Child";
import { LocomotionSchema } from "@/schemas/entity/Locomotion";
import { RadiusSchema } from "@/schemas/entity/Radius";
import { TransformSchema } from "@/schemas/entity/Transform";
import { SpineSchema } from "@/schemas/render/Spine";
import { Spine } from "pixi-spine";
import { Viewport } from "pixi-viewport";

class SpineSystem implements System {
  type = "Spine";
  category: ComponentCategory = ComponentCategory.RENDERING;
  schema = SpineSchema;
  depth = DEPTHS.DRAW + 1;
  run(entity: number, gameModel: GameModel) {
    const data = gameModel.getTyped(entity, SpineSchema);
  }
}

registerSystem(SpineSystem);

export type PixiSpineSchema = {
  spine: Spine;
  spineKey: string;
  container: PIXI.Container;
  debug?: PIXI.Container;
  lastFlip: number;
};

export class SpineComponentPixi implements PixiDrawSystem {
  ids: Set<number> = new Set();
  schema = SpineSchema;

  instances: {
    [id: number]: PixiSpineSchema;
  } = {};
  animationCache: { [id: string]: Spine[] } = {};
  imageCache: { [id: string]: Spine[] } = {};

  transform(pixiData: PixiSpineSchema, entity: number, data: SpineSchema, gameModel: GameModel, viewport: Viewport) {
    const { spine, container } = pixiData;
    const locomotionSchema = gameModel.getTyped(entity, LocomotionSchema);
    const direction = { x: locomotionSchema.directionX, y: locomotionSchema.directionY };
    // spine.anchor.set(data.anchorX, data.anchorY);
    // if (data.faceDirection === FaceDirectionEnum.ROTATE) {
    //   const angle = data.rotation
    //     ? rotationVector2d(rotateDegVector2d(direction, data.rotation))
    //     : rotationVector2d(direction);

    //   spine.rotation = angle;
    // } else if (data.rotation) {
    //   const angle = (data.rotation * Math.PI) / 180;

    //   spine.rotation = angle;
    // } else
    if (data.faceDirection === FaceDirectionEnum.HORIZONTAL) {
      let xDirection = direction.x;
      if (gameModel.hasComponent(entity, ChildSchema)) {
        const owner = gameModel.getComponent(entity, ChildSchema).parent;
        xDirection = LocomotionSchema.store.directionX[owner];
      }
      if (!data.antiJitterTime || gameModel.timeElapsed - pixiData.lastFlip > data.antiJitterTime) {
        if (xDirection < 0) {
          spine.scale.x = -1;
        } else {
          spine.scale.x = 1;
        }
        pixiData.lastFlip = gameModel.timeElapsed;
      }
    }

    if (data.xscale !== undefined) {
      spine.scale.x *= data.xscale;
    }

    if (data.yscale !== undefined) {
      spine.scale.y *= data.yscale;
    } else if (data.faceDirection === FaceDirectionEnum.VERTICAL) {
      if (!data.antiJitterTime || gameModel.timeElapsed - pixiData.lastFlip > data.antiJitterTime) {
        container.scale.y = direction.y < 0 ? -1 * data.scale : 1 * data.scale;
        pixiData.lastFlip = gameModel.timeElapsed;
      }
    }
    // } else if (data.faceDirection === FaceDirectionEnum.HORIZONTAL_ROTATE) {
    //   // let rotation = 0;
    //   // if (
    //   //   (direction.y > 0 && direction.x < 0) ||
    //   //   (direction.y < 0 && direction.x > 0)
    //   // ) {
    //   //   rotation = -45;
    //   // } else if (
    //   //   (direction.y > 0 && direction.x > 0) ||
    //   //   (direction.y < 0 && direction.x < 0)
    //   // ) {
    //   //   rotation = 45;
    //   // } else if (direction.y < 0 && direction.x == 0) {
    //   //   yoffset = 0;
    //   //   rotation = -90;
    //   // } else if (direction.y > 0 && direction.x == 0) {
    //   //   yoffset = 0;
    //   //   rotation = 90;
    //   // }
    //   // if (rotation) {
    //   //   ctx.translate(pos.x, pos.y);
    //   //   ctx.rotate((rotation * Math.PI) / 180);
    //   //   ctx.translate(-pos.x, -pos.y);
    //   // }
    //   // if (direction.x < 0) {
    //   //   xoffset -= xoffset * 2;
    //   //   ctx.translate((pos.x + xoffset) * 2, 0);
    //   //   ctx.scale(-1, 1);
    //   // }
    // }
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
    const spineData = gameModel.getTyped(entity, this.schema);
    let zIndex = 2;

    const instance: Partial<PixiSpineSchema> = {
      container: this.instances[entity]?.container ?? new PIXI.Container(),
      debug: this.instances[entity]?.debug,
      lastFlip: 0,
    };

    if (!instance.debug) {
      instance.debug = new PIXI.Container();
      instance.debug.visible = false;
      viewport.addChild(instance.debug);
    }

    const spineInstance = PixiSpineLoader.getInstance().get(spineData.spineKey) as Spine;

    if (spineData.skin) {
      spineInstance.skeleton.setSkinByName(spineData.skin);
    }

    spineInstance.state.setAnimation(0, spineData.currentAnimation, true);
    spineInstance.state.timeScale = spineData.animationSpeed || 1;
    spineInstance.autoUpdate = true;

    zIndex = spineData.zIndex || 2;

    instance.container!.addChild(spineInstance);

    instance.spine = spineInstance;
    instance.spineKey = spineData.currentAnimation;
    instance.container!.zIndex = zIndex;
    instance.spine.position.set(0, 0);
    instance.container?.scale.set(spineData.scale);

    this.instances[entity] = instance as PixiSpineSchema;
    viewport.addChild(instance.container!);
    this.ids.add(entity);
  }

  run(entity: number, gameModel: GameModel, viewport: Viewport) {
    const spineData = gameModel.getTyped(entity, this.schema);

    if (
      this.instances[entity] &&
      (spineData.currentAnimation ?? spineData.spineKey) !== this.instances[entity].spineKey
    ) {
      this.cleanup(entity, gameModel, viewport);
    }

    if (!this.instances[entity]) {
      this.init(entity, gameModel, viewport);
    }
    const pixiData = this.instances[entity];
    const { spine, container, debug } = pixiData;

    if (spineData.opacity === 0) {
      spine.visible = false;
    } else {
      spine.visible = true;
      spine.alpha = 1;
    }
    const transformSchema = gameModel.getTyped(entity, TransformSchema);

    const position = transformSchema.position;

    position.y -= transformSchema.z;

    let xoffset = 0;
    let yoffset = 0;

    const viewY = viewport.position.y;

    if (gameModel.hasComponent(entity, ChildSchema)) {
      const owner = gameModel.getComponent(entity, ChildSchema).parent;
      container.zIndex =
        TransformSchema.store.y[owner] -
        viewY +
        TransformSchema.store.z[owner] +
        RadiusSchema.store.radius[owner] +
        spineData.zIndex;
    } else {
      // const mapStripe = TransformSchema.store.y[entity] / 320;
      container.zIndex =
        TransformSchema.store.y[entity] -
        viewY +
        TransformSchema.store.z[entity] +
        RadiusSchema.store.radius[entity] +
        spineData.zIndex;
    }

    container.x = position.x + xoffset;
    container.y = position.y + yoffset;

    debug?.position.set(position.x, position.y);

    this.transform(pixiData, entity, spineData, gameModel, viewport);
  }

  cleanup(entity: number, gameModel: GameModel, viewport: Viewport) {
    const instanceData = this.instances[entity];
    if (!instanceData) {
      return;
    }
    instanceData.container.destroy();
    const instance = this.instances[entity].spine;
    delete this.instances[entity];
    instance.visible = false;
    const spineData = gameModel.getTyped(entity, this.schema);
    if (spineData.spineKey) {
      const key = instanceData.spineKey;
      this.animationCache[key] = this.animationCache[key] ?? [];
      this.animationCache[key].push(instance);
    } else {
      this.imageCache[instanceData.spineKey] = this.imageCache[instanceData.spineKey] ?? [];
      this.imageCache[instanceData.spineKey].push(instance);
    }
    this.ids.delete(entity);
  }
}

registerPixiComponent("Spine", SpineComponentPixi);
