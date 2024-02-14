import type { System } from "@/components/System";
import type { GameModel } from "@/game/GameModel";
import { ComponentCategory } from "../../components/types";
import { DEPTHS, registerSystem } from "../../components/ComponentRegistry";
import { PhysicsSystem } from "@/components/physics/Physics";
import { BV2 } from "@/utils/vector";
import { CollisionCategoryEnum } from "@/constants/enums";
import RAPIER from "@dimforge/rapier2d-compat";
import { LocomotionSchema } from "@/schemas/entity/Locomotion";
import { RadiusSchema } from "@/schemas/entity/Radius";
import { TransformSchema } from "@/schemas/entity/Transform";
import { CollisionsSchema } from "@/schemas/physics/Collisions";
import { RigidCircleResolverSchema, RigidCircleSchema } from "@/schemas/physics/RigidCircle";

export class RigidCircleSystem implements System {
  type = "RigidCircle";
  category: ComponentCategory = ComponentCategory.PHYSICS;
  schema = RigidCircleSchema;
  depth = DEPTHS.COLLISION - 0.0001;

  bodies: { [key: number]: RAPIER.RigidBody } = {};

  init(entity: number, gameModel: GameModel) {
    const transformSchema = gameModel.getTyped(entity, TransformSchema);
    const position = transformSchema.position;

    const rigidCircle = gameModel.getTyped(entity, RigidCircleSchema);

    const physicsSystem = gameModel.getSystem(PhysicsSystem);

    const engine = physicsSystem.getEngine(gameModel);

    const prevBody = this.bodies[entity];
    if (prevBody) {
      engine.removeRigidBody(prevBody);
    }

    const rigidBodyDesc = rigidCircle.isStatic ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    rigidBodyDesc.setTranslation(position.x, position.y);

    const rigidBody = engine.createRigidBody(rigidBodyDesc);

    // Create a cuboid collider attached to the dynamic rigidBody.
    let colliderDesc = RAPIER.ColliderDesc.ball(rigidCircle.radius || RadiusSchema.store.radius[entity]).setMass(
      rigidCircle.mass
    );
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

    const collider = engine.createCollider(colliderDesc, rigidBody);

    this.bodies[entity] = rigidBody;
    physicsSystem.colliderHandleMap.handleToEntity[collider.handle] = entity;
    physicsSystem.colliderHandleMap.entityToHandle[entity] = collider.handle;

    if (!gameModel.hasComponent(entity, "RigidCircleResolver")) {
      gameModel.setComponent(entity, "RigidCircleResolver");
    }
  }

  runAll?(gameModel: GameModel): void {
    const entities = gameModel.getComponentActives("RigidCircle");

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const rigidCircle = gameModel.getTyped(entity, RigidCircleSchema);

      let circle = this.bodies[entity];

      if (rigidCircle.disabled) {
        if (circle) {
          this.cleanup(entity, gameModel);
        }
        continue;
      } else {
        if (!circle) {
          this.init(entity, gameModel);
          circle = this.bodies[entity];
        }
      }

      const transformSchema = gameModel.getTyped(entity, TransformSchema);
      const position = transformSchema.position;

      const locomotionSchema = gameModel.getTyped(entity, LocomotionSchema);
      const velocity = locomotionSchema.velocity;

      const body = this.bodies[entity];
      body.setTranslation(position, true);

      let decayingVelocity: null | number[] = null;
      if (locomotionSchema.decayingVelocityTime > 0) {
        const decayTime = Math.max(150, locomotionSchema.decayingVelocityTime);
        const decayFactor = 0.25; // random ass hardcoded value
        if (locomotionSchema.decayingVelocityTime < decayTime) {
          const expDecay = Math.pow(1 - decayFactor, decayTime - locomotionSchema.decayingVelocityTime);
          decayingVelocity = BV2.lerpVector2d(
            locomotionSchema.decayingVelocityX,
            locomotionSchema.decayingVelocityY,
            0,
            0,
            expDecay
          );
          decayingVelocity[0] *= locomotionSchema.decayingVelocityScale;
          decayingVelocity[1] *= locomotionSchema.decayingVelocityScale;
        } else {
          locomotionSchema.decayingVelocityTime = decayTime;
          decayingVelocity = [locomotionSchema.decayingVelocityX, locomotionSchema.decayingVelocityY];
        }

        locomotionSchema.decayingVelocityTime -= gameModel.dt<number>(entity);
      } else {
        locomotionSchema.decayingVelocityX = 0;
        locomotionSchema.decayingVelocityY = 0;
        locomotionSchema.decayingVelocityTime = 0;
      }

      body.setLinvel(
        {
          x: (velocity.x + (decayingVelocity ? decayingVelocity[0] : 0)) * 60,
          y: (velocity.y + (decayingVelocity ? decayingVelocity[1] : 0)) * 60,
        },
        true
      );
    }
  }

  cleanup(entity: number, gameModel: GameModel) {
    gameModel.removeComponent(entity, "RigidCircleResolver");

    const physicsSystem = gameModel.getSystem(PhysicsSystem);
    const engine = physicsSystem.getEngine(gameModel);
    const collisions = gameModel.getTyped(gameModel.coreEntity, CollisionsSchema).collisionMap;
    if (collisions?.[entity]) {
      Object.keys(collisions[entity]).forEach((other) => {
        const otherKey = parseInt(other);
        if (collisions[otherKey]) {
          delete collisions[otherKey][entity];
        }
      });
      delete collisions[entity];
    }
    const handle = physicsSystem.colliderHandleMap.entityToHandle[entity];
    if (handle !== undefined) {
      const collider = engine.getCollider(handle);
      if (collider) engine.removeCollider(collider, false);
    }
    delete physicsSystem.colliderHandleMap.handleToEntity[handle];
    delete physicsSystem.colliderHandleMap.entityToHandle[entity];

    const body = this.bodies[entity];
    if (body) {
      try {
        engine.removeRigidBody(body);
      } catch (e) {}
      delete this.bodies[entity];
    }
  }
}

registerSystem(RigidCircleSystem);

class RigidCircleResolverSystem implements System {
  type = "RigidCircleResolver";
  category: ComponentCategory = ComponentCategory.PHYSICS;
  depth = DEPTHS.COLLISION + 0.0001;
  schema = RigidCircleResolverSchema;

  runAll(gameModel: GameModel) {
    const rigidCircleSystem = gameModel.getSystem(RigidCircleSystem);
    const entities = gameModel.getComponentActives("RigidCircleResolver");

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const circle = rigidCircleSystem.bodies[entity];
      const rigidCircle = gameModel.getTyped(entity, RigidCircleSchema);
      const position = circle.translation();

      const positionX = position.x;
      const positionY = position.y;

      const transformSchema = gameModel.getTyped(entity, TransformSchema);
      transformSchema.x = positionX;
      transformSchema.y = positionY;
      const locomotionSchema = gameModel.getTyped(entity, LocomotionSchema);

      if (rigidCircle.velocityLock) {
        const velocity = circle.linvel();
        locomotionSchema.velocityX = velocity.x / 60;
        locomotionSchema.velocityY = velocity.y / 60;
      }

      if (rigidCircle.directionLock) {
        const direction = circle.rotation();
        const locomotionSchema = gameModel.getTyped(entity, LocomotionSchema);
        locomotionSchema.directionX = Math.cos(direction);
        locomotionSchema.directionY = Math.sin(direction);
      }
    }
  }
}

registerSystem(RigidCircleResolverSystem);
