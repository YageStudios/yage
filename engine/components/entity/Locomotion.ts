import { registerPixiComponent, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import { BV2 } from "@/utils/vector";
import { TransformSchema } from "@/schemas/entity/Transform";
import type { System } from "@/components/System";
import { ComponentCategory } from "../../components/types";
import * as PIXI from "pixi.js";
import type { PixiDrawSystem } from "../../components/PixiDrawSystem";
import { LocomotionSchema } from "@/schemas/entity/Locomotion";
import { Viewport } from "pixi-viewport";

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface IWorld {}
export type Query<W extends IWorld = IWorld> = (world: W, clearDiff?: boolean) => number[];
class BitecsLocomotionSystem implements System {
  type = "Locomotion";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = LocomotionSchema;
  depth = 1;
  query: Query<IWorld>;

  constructor(gameModel: GameModel) {
    this.query = gameModel.defineQuery([TransformSchema, LocomotionSchema]) as Query<IWorld>;
  }

  runAll(gameModel: GameModel) {
    const entities = this.query(gameModel.world);
    for (let i = 0; i < entities.length; i++) {
      const entityId = entities[i];
      const locomotionSchema = gameModel.getTypedUnsafe(entityId, LocomotionSchema);
      const transformSchema = gameModel.getTypedUnsafe(entityId, TransformSchema);

      if (
        (locomotionSchema.decayingVelocityX || locomotionSchema.decayingVelocityY) &&
        locomotionSchema.decayingVelocityTime === 0
      ) {
        locomotionSchema.decayingVelocityTime = 150;
      }

      // let decayingVelocity: null | number[] = null;
      // if (locomotionSchema.decayingVelocityTime > 0) {
      //   const decayTime = 150;
      //   const decayFactor = 0.5; // random ass hardcoded value
      //   if (locomotionSchema.decayingVelocityTime < decayTime) {
      //     let expDecay = Math.pow(1 - decayFactor, decayTime - locomotionSchema.decayingVelocityTime);
      //     decayingVelocity = BV2.lerpVector2d(
      //       locomotionSchema.decayingVelocityX,
      //       locomotionSchema.decayingVelocityY,
      //       0,
      //       0,
      //       expDecay
      //     );
      //     decayingVelocity[0] *= locomotionSchema.decayingVelocityScale;
      //     decayingVelocity[1] *= locomotionSchema.decayingVelocityScale;
      //   } else {
      //     locomotionSchema.decayingVelocityTime = decayTime;
      //     decayingVelocity = [locomotionSchema.decayingVelocityX, locomotionSchema.decayingVelocityY];
      //   }

      //   locomotionSchema.decayingVelocityTime -= gameModel.dt<number>(entityId);
      // } else {
      //   locomotionSchema.decayingVelocityX = 0;
      //   locomotionSchema.decayingVelocityY = 0;
      //   locomotionSchema.decayingVelocityTime = 0;
      // }

      if (
        !locomotionSchema.fixedDirection &&
        (Math.round(locomotionSchema.velocityX) !== 0 || Math.round(locomotionSchema.velocityY) !== 0)
      ) {
        const direction = BV2.normalizeVector2d(locomotionSchema.velocityX, locomotionSchema.velocityY);
        locomotionSchema.directionX = direction[0];
        locomotionSchema.directionY = direction[1];
      }

      transformSchema.previousX = transformSchema.x;
      transformSchema.previousY = transformSchema.y;
      transformSchema.previousZ = transformSchema.z;

      // if (decayingVelocity) {
      //   transformSchema.x += Math.round(decayingVelocity[0] * dt);
      //   transformSchema.y += Math.round(decayingVelocity[1] * dt);
      // } else {
      //   transformSchema.x += Math.round(velocity.x * dt);
      //   transformSchema.y += Math.round(velocity.y * dt);
      // }
    }
  }
}

registerSystem(BitecsLocomotionSystem);

class DebugLocomotionDraw implements PixiDrawSystem {
  ids: Set<number> = new Set();
  entities: {
    [id: number]: {
      container: PIXI.Container;
      directionGraphic: PIXI.Graphics;
    };
  } = {};
  debug = true;

  init(entity: number, gameModel: GameModel, viewport: Viewport) {
    const container = new PIXI.Container();
    container.zIndex = 100000;

    const directionGraphic = new PIXI.Graphics();
    container.addChild(directionGraphic);

    const entityObj: any = {
      container,
      directionGraphic,
    };

    viewport.addChild(container);
    this.entities[entity] = entityObj;
    this.ids.add(entity);
  }

  run(entity: number, gameModel: GameModel) {
    const transformSchema = gameModel.getTypedUnsafe(entity, TransformSchema);
    const locomotionSchema = gameModel.getTypedUnsafe(entity, LocomotionSchema);
    const entityPosition = transformSchema.position;
    const container = this.entities[entity].container;
    container.position.set(entityPosition.x, entityPosition.y);
    const directionGraphic = this.entities[entity].directionGraphic;
    directionGraphic.clear();
    directionGraphic.lineStyle(5, 0xff0000);
    directionGraphic.moveTo(0, 0);
    directionGraphic.lineTo(locomotionSchema.directionX * 30, locomotionSchema.directionY * 30);
  }

  cleanup(entity: number) {
    if (!this.entities[entity]) {
      return;
    }
    const container = this.entities[entity].container;
    container.children.forEach((child) => {
      container.removeChild(child);
      child.destroy();
    });

    container.destroy();
    delete this.entities[entity];
    this.ids.delete(entity);
  }
}

registerPixiComponent("Locomotion", DebugLocomotionDraw);
