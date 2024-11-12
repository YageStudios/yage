import type { GameModel } from "yage/game/GameModel";
import { ComponentCategory } from "yage/systems/types";
import { PhysicsSystem } from "yage/systems/physics/Physics";
import { angleOfVector2d, scaleVector2d } from "yage/utils/vector";
import { CollisionCategoryEnum, DEPTHS } from "yage/constants/enums";
import RAPIER from "@dimforge/rapier2d-compat";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { Transform } from "yage/schemas/entity/Transform";
import { RigidBoxResolver, RigidBox } from "yage/schemas/physics/RigidBox";
import { System, SystemImpl } from "minecs";

@System(RigidBox, Transform)
export class RigidBoxSystem extends SystemImpl<GameModel> {
  static depth = DEPTHS.COLLISION - 0.0001;
  dependencies = ["Locomotion", "Transform"];

  init = (gameModel: GameModel, entity: number) => {
    const rigidBox = gameModel.getTypedUnsafe(RigidBox, entity);

    const physicsSystem = gameModel.getSystem(PhysicsSystem);

    if (physicsSystem.getRigidBody(entity) !== undefined) {
      return;
    }
    const transform = gameModel.getTypedUnsafe(Transform, entity);
    const position = { x: transform.x, y: transform.y };

    const rigidBodyDesc = rigidBox.isStatic ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic();
    rigidBodyDesc.setTranslation(position.x, position.y);

    const rigidBody = physicsSystem.createRigidBody(entity, rigidBodyDesc);

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
    const collider = physicsSystem.createCollider(entity, colliderDesc, rigidBody);

    collider.setTranslationWrtParent(rigidBox.point);

    if (!gameModel.hasComponent("RigidBoxResolver", entity)) {
      gameModel.addComponent("RigidBoxResolver", entity);
    }
  };

  runAll = (gameModel: GameModel) => {
    const entities = gameModel.getComponentActives("RigidBox");
    const physicsSystem = gameModel.getSystem(PhysicsSystem);

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      const rigidBox = gameModel.getTypedUnsafe(RigidBox, entity);

      let body = physicsSystem.getRigidBody(entity);

      if (rigidBox.disabled) {
        if (body !== undefined) {
          this.cleanup(gameModel, entity);
        }
        continue;
      } else if (body === undefined) {
        this.init(gameModel, entity);
        body = physicsSystem.getRigidBody(entity);
      }

      const transform = gameModel.getTypedUnsafe(Transform, entity);
      const position = { x: transform.x, y: transform.y };

      const locomotion = gameModel.getTypedUnsafe(Locomotion, entity);
      const velocity = { x: locomotion.x, y: locomotion.y };

      body.setTranslation(position, true);

      if (velocity) {
        body.setLinvel(scaleVector2d(velocity, 60), true);
      }

      if (gameModel.hasComponent(RigidBox, entity) && gameModel.hasComponent(Locomotion, entity)) {
        rigidBox.angle = angleOfVector2d({ x: locomotion.directionX, y: locomotion.directionY });
      }

      const rads = rigidBox.angle * (Math.PI / 180);
      if (rads !== body.rotation()) {
        body.setRotation(rads, true);
      }
    }
  };

  cleanup = (gameModel: GameModel, entity: number) => {
    gameModel.removeComponent("RigidBoxResolver", entity);
    gameModel.getSystem(PhysicsSystem).removeEntity(gameModel, entity);
  };
}

@System(RigidBoxResolver)
export class RigidBoxResolverSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.PHYSICS;
  static depth = DEPTHS.COLLISION + 0.00001;

  runAll = (gameModel: GameModel) => {
    const entities = gameModel.getComponentActives("RigidBoxResolver");
    const physicsSystem = gameModel.getSystem(PhysicsSystem);

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];

      const rigidBox = gameModel.getTypedUnsafe(RigidBox, entity);
      const box = physicsSystem.getRigidBody(entity);
      if (!box) continue;

      const position = box.translation();

      const positionX = position.x - rigidBox.point.x;
      const positionY = position.y - rigidBox.point.y;

      if (rigidBox.point.x == 0 && rigidBox.point.y === 0) {
        const transform = gameModel.getTypedUnsafe(Transform, entity);
        transform.x = positionX;
        transform.y = positionY;
      }

      if (rigidBox.velocityLock) {
        const velocity = box.linvel();
        const locomotion = gameModel.getTypedUnsafe(Locomotion, entity);

        locomotion.x = (velocity.x / 60) * (rigidBox.restitution || 1);
        locomotion.y = (velocity.y / 60) * (rigidBox.restitution || 1);
      }

      if (rigidBox.directionLock) {
        const direction = box.rotation();
        const locomotion = gameModel.getTypedUnsafe(Locomotion, entity);
        locomotion.directionX = Math.cos(direction);
        locomotion.directionY = Math.sin(direction);
      }
    }
  };
}
