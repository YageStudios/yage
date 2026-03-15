/* eslint-disable @typescript-eslint/no-non-null-assertion */
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { ComponentCategory } from "yage/systems/types";
import type { RigidBodyDesc } from "@dimforge/rapier2d-compat";
import RAPIER, { World } from "@dimforge/rapier2d-compat";
import { FrameRate } from "yage/schemas/core/FrameRate";
import { Collisions } from "yage/schemas/physics/Collisions";
import { Physics } from "yage/schemas/physics/Physics";
import { FrameRateSystem } from "yage/systems/core/FrameRate";
import { Base64 } from "js-base64";
import { cloneDeep } from "lodash";
import { DrawSystemImpl, System, SystemImpl } from "minecs";
import { DEPTHS } from "yage/constants/enums";
import { flags } from "yage/console/flags";
import { PixiViewportSystem } from "../render/PixiViewport";
import * as PIXI from "pixi.js";

export type PhysicsSaveState = {
  bodies: {
    [handle: number]: number;
  };
  colliders: {
    [handle: number]: number;
  };
  data: string;
  history: ["addCollider" | "addBody" | "removeCollider" | "removeBody", number][];
};

@System(Physics)
export class PhysicsSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.CORE;
  static depth = DEPTHS.COLLISION;

  world: RAPIER.World;
  eventQueue: RAPIER.EventQueue;

  bodies: {
    [entity: number]: RAPIER.RigidBody;
  } = {};

  colliders: {
    [entity: number]: RAPIER.Collider[];
  } = {};

  colliderHandles: {
    [handle: number]: number;
  } = {};

  collisionCounts: {
    [entity: number]: number;
  } = {};

  history: ["addCollider" | "addBody" | "removeCollider" | "removeBody", number][] = [];

  coreEntity: number;

  save(): PhysicsSaveState {
    if (!this.world) {
      return {
        bodies: {},
        colliders: {},
        data: "",
        history: cloneDeep(this.history),
      };
    }

    return {
      bodies: Object.keys(this.bodies).reduce((acc, key) => {
        const entity = +key;
        acc[this.bodies[entity].handle] = entity;
        return acc;
      }, {} as any),
      colliders: Object.keys(this.colliders).reduce((acc, key) => {
        const entity = +key;
        acc[this.colliders[entity][0].handle] = entity;
        return acc;
      }, {} as any),
      data: Base64.fromUint8Array(this.world.takeSnapshot()),
      history: cloneDeep(this.history),
    };
  }

  restore(state: PhysicsSaveState) {
    if (!state.data) {
      this.bodies = {};
      this.colliders = {};
      this.colliderHandles = {};
      this.collisionCounts = {};
      this.history = cloneDeep(state.history);
      if (!this.world) {
        this.world = new RAPIER.World({ x: 0, y: 0 });
      }
      if (!this.eventQueue) {
        this.eventQueue = new RAPIER.EventQueue(false);
      }
      return;
    }

    if (!this.world) {
      this.world = new RAPIER.World({ x: 0, y: 0 });
    }
    state.history.slice(this.history.length).forEach(([action, handle]) => {
      if (action === "addBody") {
        const basicRigid = RAPIER.RigidBodyDesc.fixed();
        this.world.createRigidBody(basicRigid);
      } else if (action === "removeBody") {
        const body = this.world.bodies.get(handle);
        if (body) {
          this.world.removeRigidBody(body);
        }
      } else if (action === "addCollider") {
        const basicCollider = RAPIER.ColliderDesc.cuboid(1, 1);
        this.world.createCollider(basicCollider, this.world.bodies.get(0)!);
      } else if (action === "removeCollider") {
        const collider = this.world.colliders.get(handle);
        if (collider) {
          this.world.removeCollider(collider, false);
        }
      }
    });
    this.world.free();

    this.history = cloneDeep(state.history);

    const world = World.restoreSnapshot(Base64.toUint8Array(state.data));
    this.bodies = {};
    this.colliders = {};
    this.collisionCounts = {};

    world.bodies.forEach((body) => {
      if (state.bodies[body.handle] === undefined) return;
      body.userData = { entity: state.bodies[body.handle] };
      this.bodies[state.bodies[body.handle]] = body;
    });
    world.forEachCollider((collider) => {
      const body = collider.parent();
      if (!body) return;
      const entity = (body.userData as any)?.entity;
      if (!entity) return;
      this.colliders[entity] = this.colliders[entity] || [];
      this.colliders[entity].push(collider);
      this.colliderHandles[collider.handle] = entity;
    });
    this.world = world;
    this.eventQueue.free();
    this.eventQueue = new RAPIER.EventQueue(false);
  }

  init = (gameModel: GameModel, entity: number) => {
    this.coreEntity = entity;

    if (!gameModel.hasComponent(Collisions, entity)) {
      gameModel.addComponent(Collisions, entity);
    }
    this.getEngine(gameModel);
  };

  getRigidBody(entity: number) {
    return this.bodies[entity];
  }

  createRigidBody(entity: number, rigidBodyDesc: RigidBodyDesc) {
    rigidBodyDesc.setUserData({ entity });
    const body = this.world.createRigidBody(rigidBodyDesc);
    body.userData = { entity };
    this.bodies[entity] = body;
    this.history.push(["addBody", body.handle]);
    return body;
  }

  removeRigidBody(bodyOrHandle: RAPIER.RigidBody | number) {
    if (typeof bodyOrHandle === "number") {
      const body = this.bodies[bodyOrHandle];
      if (body) {
        this.history.push(["removeBody", body.handle]);
        this.world.removeRigidBody(body);
        delete this.bodies[bodyOrHandle];
      }
    } else {
      this.history.push(["removeBody", bodyOrHandle.handle]);
      this.world.removeRigidBody(bodyOrHandle);
      delete this.bodies[bodyOrHandle.handle];
    }
  }

  createCollider(entity: number, colliderDesc: RAPIER.ColliderDesc, body: RAPIER.RigidBody) {
    const collider = this.world.createCollider(colliderDesc, body);
    if (entity === -1) {
      return collider;
    }
    this.colliders[entity] = this.colliders[entity] || [];
    this.colliders[entity].push(collider);
    this.colliderHandles[collider.handle] = entity;
    this.history.push(["addCollider", collider.handle]);
    return collider;
  }

  removeEntityColliders(entity: number) {
    const colliders = this.colliders[entity];
    if (colliders) {
      for (const collider of colliders) {
        this.world.removeCollider(collider, false);
        delete this.colliderHandles[collider.handle];
      }
      delete this.colliders[entity];
    }
  }

  removeCollider(bodyOrHandle: RAPIER.Collider | number) {
    if (typeof bodyOrHandle !== "number") {
      bodyOrHandle = bodyOrHandle.handle;
    }
    const entity = this.colliderHandles[bodyOrHandle];
    const collider = this.colliders[entity].find((c) => c.handle === bodyOrHandle);
    if (collider) {
      this.history.push(["removeCollider", collider.handle]);
      this.world.removeCollider(collider, false);
      this.colliders[entity] = this.colliders[entity].filter((c) => c !== collider);
      delete this.colliderHandles[bodyOrHandle];
    }
  }

  removeEntity(gameModel: GameModel, entity: number) {
    const collisions = gameModel.getTypedUnsafe(Collisions, this.coreEntity);
    const collisionMap = collisions.collisionMap;
    const row = collisionMap[entity];
    if (row) {
      for (const otherEntity in row) {
        const otherEntityNum = +otherEntity;
        const otherRow = collisionMap[otherEntityNum];
        if (otherRow && otherRow[entity]) {
          delete otherRow[entity];
          const count = (this.collisionCounts[otherEntityNum] || 1) - 1;
          if (count <= 0) {
            delete this.collisionCounts[otherEntityNum];
            delete collisionMap[otherEntityNum];
          } else {
            this.collisionCounts[otherEntityNum] = count;
          }
        }
      }
      delete collisionMap[entity];
      delete this.collisionCounts[entity];
    }

    this.removeEntityColliders(entity);
    const body = this.bodies[entity];
    if (body) {
      this.world.removeRigidBody(body);
      delete this.bodies[entity];
    }
  }

  getEngine(gameModel: GameModel) {
    if (!this.world) {
      const physics = gameModel.getTypedUnsafe(Physics, this.coreEntity);

      this.world = new RAPIER.World({ x: physics.gravityX, y: physics.gravityY });
      this.world.timestep = 0.016;
      this.eventQueue = new RAPIER.EventQueue(false);
    }
    return this.world;
  }

  runAll = (gameModel: GameModel) => {
    // const dt = gameModel.dt<number>(this.coreEntity);
    const simulatedFrames = 1; //  Math.round(dt / 16);
    const physics = gameModel.getTypedUnsafe(Physics, this.coreEntity);

    const collisions = gameModel.getTypedUnsafe(Collisions, this.coreEntity);
    const collisionMap = collisions.collisionMap;
    // Keep the legacy surface (`collisions`) pointing at the active pair map.
    // Filtered lookups are derived lazily in `checkCollisionFilter`.
    collisions.collisions = collisionMap;

    if (gameModel.hasComponent(FrameRate, this.coreEntity)) {
      gameModel.getSystem(FrameRateSystem).get(gameModel.coreEntity).bodies = this.world.bodies.len();
    }

    for (let i = 0; i < simulatedFrames; i++) {
      this.world.step(this.eventQueue);
      this.eventQueue.drainCollisionEvents((handle1, handle2, started) => {
        const eid1 = this.colliderHandles[handle1];
        const eid2 = this.colliderHandles[handle2];

        if (eid1 === undefined || eid2 === undefined) {
          return;
        }

        if (started) {
          const row1 = collisionMap[eid1] || (collisionMap[eid1] = {});
          if (!row1[eid2]) {
            row1[eid2] = true;
            const row2 = collisionMap[eid2] || (collisionMap[eid2] = {});
            row2[eid1] = true;
            this.collisionCounts[eid1] = (this.collisionCounts[eid1] || 0) + 1;
            this.collisionCounts[eid2] = (this.collisionCounts[eid2] || 0) + 1;
          }
        } else {
          const row1 = collisionMap[eid1];
          if (row1 && row1[eid2]) {
            delete row1[eid2];
            const count1 = (this.collisionCounts[eid1] || 1) - 1;
            if (count1 <= 0) {
              delete this.collisionCounts[eid1];
              delete collisionMap[eid1];
            } else {
              this.collisionCounts[eid1] = count1;
            }
          }
          const row2 = collisionMap[eid2];
          if (row2 && row2[eid1]) {
            delete row2[eid1];
            const count2 = (this.collisionCounts[eid2] || 1) - 1;
            if (count2 <= 0) {
              delete this.collisionCounts[eid2];
              delete collisionMap[eid2];
            } else {
              this.collisionCounts[eid2] = count2;
            }
          }
        }
      });
    }
  };

  cleanup = () => {
    this.world.forEachRigidBody((body) => {
      this.world.removeRigidBody(body);
    });
    this.world.forEachCollider((collider) => {
      this.world.removeCollider(collider, false);
    });
    // @ts-ignore
    this.world = null;
    this.collisionCounts = {};
  };
}

@System(Physics)
export class PhysicsDrawPixiSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static category: ComponentCategory = ComponentCategory.CORE;
  static depth = DEPTHS.COLLISION;

  lines: PIXI.Graphics | undefined;

  run = (gameModel: ReadOnlyGameModel) => {
    const physics = gameModel.getTypedUnsafe(Physics, gameModel.coreEntity);
    let lines = this.lines;
    if (flags.PHYSICS) {
      const viewport = gameModel.getSystem(PixiViewportSystem);
      const pixi = viewport.pixiApp;

      if (!lines) {
        lines = new PIXI.Graphics();
        lines.zIndex = Number.MAX_SAFE_INTEGER;
        viewport.viewport.addChild(lines);
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
    this.lines = lines;
  };
}

// let lines: PIXI.Graphics | undefined;

// registerUIComponent(
//   "Physics",
//   (uiService, entity, renderModel: RenderModel) => {
//     if (flags.PHYSICS) {
//       if (!lines) {
//         lines = new PIXI.Graphics();
//         lines.zIndex = Number.MAX_SAFE_INTEGER;
//         renderModel.pixiViewport.addChild(lines);
//       }
//       const buffers = renderModel.gameModel.getSystem(PhysicsSystem).world.debugRender();
//       const vtx = buffers.vertices;
//       const cls = buffers.colors;

//       lines.clear();

//       for (let i = 0; i < vtx.length / 4; i += 1) {
//         const color = PIXI.Color.shared.setValue([cls[i * 8], cls[i * 8 + 1], cls[i * 8 + 2]]).toHex();
//         lines.lineStyle(1.0, color, cls[i * 8 + 3], 0.5, true);
//         lines.moveTo(vtx[i * 4], vtx[i * 4 + 1]);
//         lines.lineTo(vtx[i * 4 + 2], vtx[i * 4 + 3]);
//       }
//     } else if (lines) {
//       lines.clear();
//       lines.destroy();
//       lines = undefined;
//     }
//   },
//   {
//     cleanup: () => {
//       if (lines) {
//         lines.clear();
//         lines.destroy();
//         lines = undefined;
//       }
//     },
//   }
// );
