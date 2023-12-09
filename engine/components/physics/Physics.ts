/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { System } from "@/components/System";
import type { GameModel } from "@/game/GameModel";
import { ComponentCategory } from "../../components/types";
import { DEPTHS, registerUIComponent, registerSystem } from "../../components/ComponentRegistry";
import { EntityTypeSchema } from "../../components";
import RAPIER, { World } from "@dimforge/rapier2d-compat";
import { hacks } from "@/console/hacks";
import * as PIXI from "pixi.js";
import { FrameRateSchema } from "@/schemas/core/FrameRate";
import { CollisionFiltersSchema, CollisionsSchema } from "@/schemas/physics/Collisions";
import { PhysicsSchema } from "@/schemas/physics/Physics";
import { md5 } from "@/utils/md5";
import { Viewport } from "pixi-viewport";

export class PhysicsSystem implements System {
  type = "Physics";
  category: ComponentCategory = ComponentCategory.CORE;
  schema = PhysicsSchema;
  depth = DEPTHS.COLLISION;

  world: RAPIER.World;
  eventQueue: RAPIER.EventQueue;
  colliderHandleMap: {
    handleToEntity: { [handle: number]: number };
    entityToHandle: { [entity: number]: number };
  } = {
    handleToEntity: {},
    entityToHandle: {},
  };

  getEngine(gameModel: GameModel) {
    if (!this.world) {
      console.error("Physics system not initialized");
      const physics = gameModel.getTyped(gameModel.coreEntity, PhysicsSchema);

      this.world = new RAPIER.World({ x: physics.gravityX, y: physics.gravityY });
      this.world.timestep = 0.016;
      this.eventQueue = new RAPIER.EventQueue(false);
    }
    return this.world;
  }

  runAll?(gameModel: GameModel): void {
    const dt = gameModel.dt<number>(gameModel.coreEntity);
    const simulatedFrames = Math.round(dt / 16.666666666666668);

    const collisionsSchema = gameModel.getTyped(gameModel.coreEntity, CollisionsSchema);
    collisionsSchema.collisions = {};

    const collisionMap = collisionsSchema.collisionMap;

    if (gameModel.hasComponent(gameModel.coreEntity, FrameRateSchema)) {
      const frameRateSchema = gameModel.getTyped(gameModel.coreEntity, FrameRateSchema);
      frameRateSchema.bodies = this.world.bodies.len();
    }

    for (let i = 0; i < simulatedFrames; i++) {
      this.world.step(this.eventQueue);
      this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        const eid1 = this.colliderHandleMap.handleToEntity[handle1];
        const eid2 = this.colliderHandleMap.handleToEntity[handle2];
        if (eid1 === undefined || eid2 === undefined) {
          return;
        }

        // if (started) {
        //   if (!collisionsSchema.collisions[eid1]) collisionsSchema.collisions[eid1] = {};
        //   if (!collisionsSchema.collisions[eid2]) collisionsSchema.collisions[eid2] = {};

        //   collisionsSchema.collisions[eid1][eid2] = true;
        //   collisionsSchema.collisions[eid2][eid1] = true;
        // } else {
        //   if (collisionsSchema.collisions[eid1]) delete collisionsSchema.collisions[eid1][eid2];
        //   if (collisionsSchema.collisions[eid2]) delete collisionsSchema.collisions[eid2][eid1];
        // }
        if (started) {
          collisionMap[eid1] = collisionMap[eid1] || {};
          collisionMap[eid2] = collisionMap[eid2] || {};
          collisionMap[eid1][eid2] = true;
          collisionMap[eid2][eid1] = true;
        } else {
          if (collisionMap[eid1]) delete collisionMap[eid1][eid2];
          if (collisionMap[eid2]) delete collisionMap[eid2][eid1];
        }
      });

      const pairs = Object.keys(collisionMap).reduce((acc, eid1) => {
        const eid2s = Object.keys(collisionMap[parseInt(eid1)]);
        for (const eid2 of eid2s) {
          if (eid1 > eid2) continue;
          acc.add((parseInt(eid1) << 16) | parseInt(eid2));
        }
        return acc;
      }, new Set<number>());

      for (const pair of pairs) {
        const eid1 = pair >> 16;
        const eid2 = pair & 0xffff;
        if (isNaN(eid1) || isNaN(eid2)) continue;
        if (!collisionsSchema.collisions[eid1]) collisionsSchema.collisions[eid1] = {};
        if (!collisionsSchema.collisions[eid2]) collisionsSchema.collisions[eid2] = {};
        collisionsSchema.collisions[eid1][eid2] = true;
        collisionsSchema.collisions[eid2][eid1] = true;
        if (gameModel.hasComponent(eid1, CollisionFiltersSchema)) {
          const filtersSchema = gameModel.getTyped(eid1, CollisionFiltersSchema);
          if (filtersSchema.filters.length > 0) {
            EntityTypeSchema.id = eid2;
            const entityType = EntityTypeSchema.entityType;
            if (!collisionsSchema.collisions[eid1].filters) collisionsSchema.collisions[eid1].filters = {};
            if (filtersSchema.filters.includes(entityType)) {
              if (!collisionsSchema.collisions[eid1].filters![entityType])
                collisionsSchema.collisions[eid1].filters![entityType] = [];
              collisionsSchema.collisions[eid1].filters![entityType].push(eid2);
            }
          }
        }
        if (gameModel.hasComponent(eid2, CollisionFiltersSchema)) {
          const filtersSchema = gameModel.getTyped(eid2, CollisionFiltersSchema);
          if (filtersSchema.filters.length > 0) {
            EntityTypeSchema.id = eid1;
            const entityType = EntityTypeSchema.entityType;
            if (!collisionsSchema.collisions[eid2].filters) collisionsSchema.collisions[eid2].filters = {};
            if (filtersSchema.filters.includes(entityType)) {
              if (!collisionsSchema.collisions[eid2].filters![entityType])
                collisionsSchema.collisions[eid2].filters![entityType] = [];
              collisionsSchema.collisions[eid2].filters![entityType].push(eid1);
            }
          }
        }
      }
    }
  }

  cleanup() {
    this.world.bodies.forEach((body) => {
      this.world.removeRigidBody(body);
    });
    // @ts-ignore
    this.world = null;
  }
}

registerSystem(PhysicsSystem);

let lines: PIXI.Graphics | undefined;

registerUIComponent("Physics", (uiService, entity, gameModel: GameModel, viewport: Viewport) => {
  if (hacks.DEBUG) {
    if (!lines) {
      lines = new PIXI.Graphics();
      viewport.addChild(lines);
    }
    const buffers = gameModel.getSystem(PhysicsSystem).world.debugRender();
    const vtx = buffers.vertices;
    const cls = buffers.colors;

    lines.clear();

    for (let i = 0; i < vtx.length / 4; i += 1) {
      const color = PIXI.Color.shared.setValue([cls[i * 8], cls[i * 8 + 1], cls[i * 8 + 2]]).toHex();
      lines.lineStyle(1.0, color, cls[i * 8 + 3], 0.5, true);
      lines.moveTo(vtx[i * 4], vtx[i * 4 + 1]);
      lines.lineTo(vtx[i * 4 + 2], vtx[i * 4 + 3]);
    }
  } else if (lines) {
    lines.clear();
    lines.destroy();
    lines = undefined;
  }
});
