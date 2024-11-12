import type { GameModel } from "yage/game/GameModel";
import { ComponentCategory } from "../../systems/types";
import { PhysicsSystem } from "yage/systems/physics/Physics";
import { BV2 } from "yage/utils/vector";
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

  init = (gameModel: GameModel, entity: number) => {
    const transform = gameModel.getTypedUnsafe(Transform, entity);
    const position = { x: transform.x, y: transform.y };

    const rigidCircle = gameModel.getTypedUnsafe(RigidCircle, entity);
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

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      const rigidCircle = gameModel.getTypedUnsafe(RigidCircle, entity);

      if (rigidCircle.disabled) {
        if (physicsSystem.getRigidBody(entity) !== undefined) {
          this.cleanup(gameModel, entity);
        }
        continue;
      } else if (physicsSystem.getRigidBody(entity) === undefined) {
        this.init(gameModel, entity);
      }

      const transform = gameModel.getTypedUnsafe(Transform, entity);
      const position = { x: transform.x, y: transform.y };

      const locomotion = gameModel.getTypedUnsafe(Locomotion, entity);
      const velocity = { x: locomotion.x, y: locomotion.y };

      const body = physicsSystem.getRigidBody(entity);
      body.setTranslation(position, true);

      let decayingVelocity: null | number[] = null;
      if (locomotion.decayingVelocityTime > 0) {
        const decayTime = Math.max(150, locomotion.decayingVelocityTime);
        const decayFactor = 0.25; // random ass hardcoded value
        if (locomotion.decayingVelocityTime < decayTime) {
          const expDecay = Math.pow(1 - decayFactor, decayTime - locomotion.decayingVelocityTime);
          decayingVelocity = BV2.lerpVector2d(
            locomotion.decayingVelocityX,
            locomotion.decayingVelocityY,
            0,
            0,
            expDecay
          );
          decayingVelocity[0] *= locomotion.decayingVelocityScale;
          decayingVelocity[1] *= locomotion.decayingVelocityScale;
        } else {
          locomotion.decayingVelocityTime = decayTime;
          decayingVelocity = [locomotion.decayingVelocityX, locomotion.decayingVelocityY];
        }

        locomotion.decayingVelocityTime -= 16; //gameModel.dt<number>(entity);
      } else {
        locomotion.decayingVelocityX = 0;
        locomotion.decayingVelocityY = 0;
        locomotion.decayingVelocityTime = 0;
      }

      body.setLinvel(
        {
          x: (velocity.x + (decayingVelocity ? decayingVelocity[0] : 0)) * 60,
          y: (velocity.y + (decayingVelocity ? decayingVelocity[1] : 0)) * 60,
        },
        true
      );
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

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const rigidCircle = gameModel.getTypedUnsafe(RigidCircle, entity);
      const circle = physicsSystem.getRigidBody(entity);
      const position = circle.translation();

      const positionX = position.x;
      const positionY = position.y;

      const transform = gameModel.getTypedUnsafe(Transform, entity);
      transform.x = positionX;
      transform.y = positionY;
      const locomotion = gameModel.getTypedUnsafe(Locomotion, entity);

      if (rigidCircle.velocityLock) {
        const velocity = circle.linvel();
        locomotion.x = velocity.x / 60;
        locomotion.y = velocity.y / 60;
      }

      if (rigidCircle.directionLock) {
        const direction = circle.rotation();
        const locomotion = gameModel.getTypedUnsafe(Locomotion, entity);
        locomotion.directionX = Math.cos(direction);
        locomotion.directionY = Math.sin(direction);
      }
    }
  };
}
