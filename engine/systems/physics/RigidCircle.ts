import type { GameModel } from "yage/game/GameModel";
import { ComponentCategory } from "../../systems/types";
import { PhysicsSystem } from "yage/systems/physics/Physics";
import { CollisionCategoryEnum, DEPTHS } from "yage/constants/enums";
import RAPIER from "@dimforge/rapier2d-compat";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { Radius } from "yage/schemas/entity/Radius";
import { Transform } from "yage/schemas/entity/Transform";
import { RigidCircleResolver, RigidCircle } from "yage/schemas/physics/RigidCircle";
import { System, SystemImpl } from "minecs";
import { MapIsometric } from "yage/schemas/map/Map";

@System(RigidCircle, Transform)
export class RigidCircleSystem extends SystemImpl<GameModel> {
  depth = DEPTHS.COLLISION - 0.0001;
  dependencies = ["Locomotion", "Transform"];
  private static readonly TRANSLATION_EPSILON_SQ = 0.000001;

  private _tempPos = { x: 0, y: 0 };
  private _tempVel = { x: 0, y: 0 };

  init = (gameModel: GameModel, entity: number) => {
    const rigidCircle = gameModel.getTypedUnsafe(RigidCircle, entity);
    if (rigidCircle.disabled) {
      return;
    }

    const transform = gameModel.getTypedUnsafe(Transform, entity);
    const position = { x: transform.x, y: transform.y };

    const physicsSystem = gameModel.getSystem(PhysicsSystem);

    if (physicsSystem.getRigidBody(entity) !== undefined) {
      return;
    }

    const rigidBodyDesc = rigidCircle.isStatic ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    rigidBodyDesc.setTranslation(position.x, position.y);

    let colliderDesc;
    if (rigidCircle.isometric && gameModel.hasComponent(MapIsometric, gameModel.coreEntity)) {
      rigidBodyDesc.rotationsEnabled = false;
      // Create an approximation of the isometric circle using a convex hull
      const numPoints = 16;
      const vertices = [];
      const radius = rigidCircle.radius || gameModel(Radius).store.radius[entity];

      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        let x = radius * Math.cos(angle);
        let y = radius * Math.sin(angle);

        // Apply isometric transformation
        const isoX = (x - y) * Math.cos(Math.PI / 4) * Math.SQRT2;
        const isoY = (x + y) * Math.sin(Math.PI / 4) * 0.5 * Math.SQRT2;

        vertices.push(isoX, isoY);
      }

      const pointsF32 = new Float32Array(vertices);
      colliderDesc = RAPIER.ColliderDesc.convexHull(pointsF32);

      if (!colliderDesc) {
        console.error("Failed to create convex hull for isometric circle");
        return;
      }
    } else {
      colliderDesc = RAPIER.ColliderDesc.ball(rigidCircle.radius || gameModel(Radius).store.radius[entity]);
    }

    colliderDesc.setMass(rigidCircle.mass);
    if (rigidCircle.restitution) {
      colliderDesc.setRestitution(rigidCircle.restitution);
    }

    let filterMask = CollisionCategoryEnum.ALL as number;
    if (rigidCircle.collisionMask) {
      filterMask = rigidCircle.collisionMask.reduce((acc, val) => acc | val, 0);
    }
    const memberMask = rigidCircle.collisionCategory << 16;

    colliderDesc.setCollisionGroups(memberMask | filterMask);
    if (rigidCircle.isSensor) {
      colliderDesc = colliderDesc.setSensor(true);
    }
    if (rigidCircle.collisionEvents) {
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    }

    const rigidBody = physicsSystem.createRigidBody(entity, rigidBodyDesc);
    physicsSystem.createCollider(entity, colliderDesc, rigidBody);

    if (!gameModel.hasComponent("RigidCircleResolver", entity)) {
      gameModel.addComponent("RigidCircleResolver", entity);
    }
  };

  runAll = (gameModel: GameModel) => {
    const entities = gameModel.getComponentActives("RigidCircle");
    const physicsSystem = gameModel.getSystem(PhysicsSystem);
    const rigidCircleStore = gameModel(RigidCircle).store;
    const transformStore = gameModel(Transform).store;
    const locomotionStore = gameModel(Locomotion).store;
    const decayFactor = 0.25;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      let body = physicsSystem.getRigidBody(entity);

      if (rigidCircleStore.disabled[entity]) {
        if (body !== undefined) {
          this.cleanup(gameModel, entity);
        }
        continue;
      } else if (body === undefined) {
        this.init(gameModel, entity);
        body = physicsSystem.getRigidBody(entity);
        if (!body) {
          continue;
        }
      }

      const position = this._tempPos;
      position.x = transformStore.x[entity];
      position.y = transformStore.y[entity];

      const velocity = this._tempVel;
      velocity.x = locomotionStore.x[entity];
      velocity.y = locomotionStore.y[entity];

      const bodyPosition = body.translation();
      const dx = position.x - bodyPosition.x;
      const dy = position.y - bodyPosition.y;
      if (dx * dx + dy * dy > RigidCircleSystem.TRANSLATION_EPSILON_SQ) {
        body.setTranslation(position, true);
      }

      let decayX = 0;
      let decayY = 0;
      const decayingVelocityTime = locomotionStore.decayingVelocityTime[entity];
      if (decayingVelocityTime > 0) {
        const decayTime = Math.max(150, decayingVelocityTime);
        const decayingVelocityX = locomotionStore.decayingVelocityX[entity];
        const decayingVelocityY = locomotionStore.decayingVelocityY[entity];
        const decayingVelocityScale = locomotionStore.decayingVelocityScale[entity];

        if (decayingVelocityTime < decayTime) {
          const expDecay = Math.pow(1 - decayFactor, decayTime - decayingVelocityTime);
          const baseScale = (1 - expDecay) * decayingVelocityScale;
          decayX = decayingVelocityX * baseScale;
          decayY = decayingVelocityY * baseScale;
        } else {
          locomotionStore.decayingVelocityTime[entity] = decayTime;
          decayX = decayingVelocityX;
          decayY = decayingVelocityY;
        }

        locomotionStore.decayingVelocityTime[entity] -= 16; //gameModel.dt<number>(entity);
      } else {
        locomotionStore.decayingVelocityX[entity] = 0;
        locomotionStore.decayingVelocityY[entity] = 0;
        locomotionStore.decayingVelocityTime[entity] = 0;
      }

      velocity.x = (velocity.x + decayX) * 60;
      velocity.y = (velocity.y + decayY) * 60;

      if (!rigidCircleStore.isStatic[entity]) {
        body.setLinvel(velocity, true);
      }
    }
  };

  cleanup = (gameModel: GameModel, entity: number) => {
    gameModel.removeComponent("RigidCircleResolver", entity);
    gameModel.getSystem(PhysicsSystem).removeEntity(gameModel, entity);
  };
}

@System(RigidCircleResolver)
export class RigidCircleResolverSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.PHYSICS;
  static depth = DEPTHS.COLLISION + 0.0001;

  runAll = (gameModel: GameModel) => {
    const physicsSystem = gameModel.getSystem(PhysicsSystem);
    const entities = gameModel.getComponentActives("RigidCircleResolver");
    const rigidCircleStore = gameModel(RigidCircle).store;
    const transformStore = gameModel(Transform).store;
    const locomotionStore = gameModel(Locomotion).store;

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      if (rigidCircleStore.disabled[entity]) {
        continue;
      }
      const circle = physicsSystem.getRigidBody(entity);
      if (!circle) {
        continue;
      }
      const position = circle.translation();

      transformStore.x[entity] = position.x;
      transformStore.y[entity] = position.y;

      if (rigidCircleStore.velocityLock[entity] && gameModel.hasComponent(Locomotion, entity)) {
        const velocity = circle.linvel();
        locomotionStore.x[entity] = velocity.x / 60;
        locomotionStore.y[entity] = velocity.y / 60;
      }

      if (rigidCircleStore.directionLock[entity] && gameModel.hasComponent(Locomotion, entity)) {
        const direction = circle.rotation();
        locomotionStore.directionX[entity] = Math.cos(direction);
        locomotionStore.directionY[entity] = Math.sin(direction);
      }
    }
  };
}
