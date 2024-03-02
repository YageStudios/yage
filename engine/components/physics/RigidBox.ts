import type { System } from "@/components/System";
import type { GameModel } from "@/game/GameModel";
import { ComponentCategory } from "../../components/types";
import { DEPTHS, registerSystem } from "../../components/ComponentRegistry";
import { PhysicsSystem } from "@/components/physics/Physics";
import { angleOfVector2d, scaleVector2d } from "@/utils/vector";
import { CollisionCategoryEnum } from "@/constants/enums";
import RAPIER from "@dimforge/rapier2d-compat";
import { LocomotionSchema } from "@/schemas/entity/Locomotion";
import { TransformSchema } from "@/schemas/entity/Transform";
import { CollisionsSchema } from "@/schemas/physics/Collisions";
import { RigidBoxResolverSchema, RigidBoxSchema } from "@/schemas/physics/RigidBox";

export class RigidBoxSystem implements System {
  type = "RigidBox";
  category: ComponentCategory = ComponentCategory.PHYSICS;
  schema = RigidBoxSchema;
  depth = DEPTHS.COLLISION - 0.0001;

  bodies: { [key: number]: RAPIER.RigidBody } = {};

  init(entity: number, gameModel: GameModel) {
    const rigidBox = gameModel.getTypedUnsafe(entity, RigidBoxSchema);

    const transformSchema = gameModel.getTypedUnsafe(entity, TransformSchema);
    const position = transformSchema.position;

    const physicsSystem = gameModel.getSystem(PhysicsSystem);

    const engine = physicsSystem.getEngine(gameModel);

    const prevBody = this.bodies[entity];
    if (prevBody) {
      engine.removeRigidBody(prevBody);
    }

    const rigidBodyDesc = rigidBox.isStatic ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    rigidBodyDesc.setTranslation(position.x, position.y);

    const rigidBody = engine.createRigidBody(rigidBodyDesc);

    // Create a cuboid collider attached to the dynamic rigidBody.
    let colliderDesc = RAPIER.ColliderDesc.cuboid(rigidBox.width / 2, rigidBox.height / 2).setMass(rigidBox.mass);

    let filterMask = CollisionCategoryEnum.ALL as number;
    if (rigidBox.collisionMask) {
      filterMask = rigidBox.collisionMask.reduce((acc, val) => acc | val, 0);
    }
    const memberMask = rigidBox.collisionCategory << 16;

    colliderDesc.setCollisionGroups(memberMask | filterMask);

    if (rigidBox.isSensor) {
      colliderDesc = colliderDesc.setSensor(true);
    }

    if (rigidBox.collisionEvents) {
      colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    }
    const collider = engine.createCollider(colliderDesc, rigidBody);

    collider.setTranslationWrtParent(rigidBox.point);
    physicsSystem.colliderHandleMap.entityToHandle[entity] = collider.handle;
    physicsSystem.colliderHandleMap.handleToEntity[collider.handle] = entity;

    this.bodies[entity] = rigidBody;

    if (!gameModel.hasComponent(entity, "RigidBoxResolver")) {
      gameModel.setComponent(entity, "RigidBoxResolver");
    }
  }

  runAll(gameModel: GameModel): void {
    const entities = gameModel.getComponentActives("RigidBox");

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const rigidBox = gameModel.getTypedUnsafe(entity, RigidBoxSchema);

      let body = this.bodies[entity];

      if (rigidBox.disabled) {
        if (body) {
          this.cleanup(entity, gameModel);
        }
        continue;
      } else {
        if (!body) {
          this.init(entity, gameModel);
          body = this.bodies[entity];
        }
      }

      const transformSchema = gameModel.getTypedUnsafe(entity, TransformSchema);
      const position = transformSchema.position;

      const locomotionSchema = gameModel.getTypedUnsafe(entity, LocomotionSchema);
      const velocity = locomotionSchema.velocity;

      body.setTranslation(position, true);

      if (velocity) {
        body.setLinvel(scaleVector2d(velocity, 60), true);
      }

      if (gameModel.hasComponent(entity, RigidBoxSchema) && gameModel.hasComponent(entity, LocomotionSchema)) {
        rigidBox.angle = angleOfVector2d({ x: locomotionSchema.directionX, y: locomotionSchema.directionY });
      }

      const rads = rigidBox.angle * (Math.PI / 180);
      if (rads !== body.rotation()) {
        body.setRotation(rads, true);
      }
    }
  }

  cleanup(entity: number, gameModel: GameModel) {
    gameModel.removeComponent(entity, "RigidBoxResolver");

    const physicsSystem = gameModel.getSystem(PhysicsSystem);
    const engine = physicsSystem.getEngine(gameModel);
    const collisions = gameModel.getTypedUnsafe(gameModel.coreEntity, CollisionsSchema).collisionMap;
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

registerSystem(RigidBoxSystem);

class RigidBoxResolverSystem implements System {
  type = "RigidBoxResolver";
  category: ComponentCategory = ComponentCategory.PHYSICS;
  depth = DEPTHS.COLLISION + 0.00001;
  schema = RigidBoxResolverSchema;

  runAll(gameModel: GameModel) {
    const rigidBoxSystem = gameModel.getSystem(RigidBoxSystem);
    const entities = gameModel.getComponentActives("RigidBoxResolver");

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      const box = rigidBoxSystem.bodies[entity];
      const rigidBox = gameModel.getTypedUnsafe(entity, RigidBoxSchema);
      if (!box) continue;

      const position = box.translation();

      const positionX = position.x - rigidBox.point.x;
      const positionY = position.y - rigidBox.point.y;

      if (rigidBox.point.x == 0 && rigidBox.point.y === 0) {
        const transformSchema = gameModel.getTypedUnsafe(entity, TransformSchema);
        transformSchema.x = positionX;
        transformSchema.y = positionY;
      }

      if (rigidBox.velocityLock) {
        const velocity = box.linvel();
        const locomotionSchema = gameModel.getTypedUnsafe(entity, LocomotionSchema);

        locomotionSchema.velocityX = (velocity.x / 60) * (rigidBox.restitution || 1);
        locomotionSchema.velocityY = (velocity.y / 60) * (rigidBox.restitution || 1);
      }

      if (rigidBox.directionLock) {
        const direction = box.rotation();
        const locomotionSchema = gameModel.getTypedUnsafe(entity, LocomotionSchema);
        locomotionSchema.directionX = Math.cos(direction);
        locomotionSchema.directionY = Math.sin(direction);
      }
    }
  }
}

registerSystem(RigidBoxResolverSystem);
