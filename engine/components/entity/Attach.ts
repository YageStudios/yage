import { Component, Schema } from "../../decorators/type";
import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import { LocomotionSchema } from "../../schemas/entity/Locomotion";
import type { System } from "../System";
import { ComponentCategory } from "../types";
import { ParentSchema } from "../../schemas/entity/Parent";
import { TransformSchema } from "@/schemas/entity/Transform";
import { AttachSchema } from "@/schemas/entity/Attach";
import { AttachedSchema } from "@/schemas/entity/Attached";

@Component("AttachPost")
export class AttachPostSchema extends Schema {}

class AttachSystem implements System {
  type = "Attach";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = AttachSchema;
  depth = DEPTHS.LOCOMOTION + 10;
  dependencies = ["Owner", "Transform", "Locomotion"];

  init(entity: number, gameModel: GameModel) {
    if (!gameModel.hasComponent(entity, "AttachPost")) {
      gameModel.setComponent(entity, "AttachPost");
    }
    const AttachData = gameModel.getTyped(entity, AttachSchema);

    if (AttachData.parent == undefined && gameModel.hasComponent(entity, "Owner")) {
      const ownerData = gameModel.getComponent(entity, "Owner");
      if (ownerData.owner != undefined) {
        AttachData.parent = ownerData.owner;
      }
    }
  }

  run(entity: number, gameModel: GameModel) {
    const AttachData = gameModel.getTyped(entity, AttachSchema);
    if (AttachData.parent != undefined) {
      if (!gameModel.isActive(AttachData.parent)) {
        AttachData.parent = null;
        return;
      }
      if (!gameModel.hasComponent(AttachData.parent, "Attached")) {
        gameModel.setComponent(AttachData.parent, "Attached", {
          children: [entity],
        });
      } else {
        const parentData = gameModel.getTyped(AttachData.parent, AttachedSchema);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
        }
      }

      let transformSchema = gameModel.getTyped(AttachData.parent, TransformSchema);
      const ownerPosition = transformSchema.position;

      transformSchema = gameModel.getTyped(entity, TransformSchema);
      transformSchema.x = ownerPosition.x;
      transformSchema.y = ownerPosition.y;

      if (AttachData.offset) {
        transformSchema.x += AttachData.offset.x;
        transformSchema.y += AttachData.offset.y;
      }

      if (
        AttachData.direction &&
        gameModel.hasComponent(entity, "Locomotion") &&
        gameModel.hasComponent(AttachData.parent, "Locomotion")
      ) {
        let locomotionSchema = gameModel.getTyped(AttachData.parent, LocomotionSchema);
        const parentDirectionX = locomotionSchema.directionX;
        const parentDirectionY = locomotionSchema.directionY;

        locomotionSchema = gameModel.getTyped(entity, LocomotionSchema);
        locomotionSchema.directionX = parentDirectionX;
        locomotionSchema.directionY = parentDirectionY;
      }
    }
  }
}

registerSystem(AttachSystem);

class AttachPostSystem implements System {
  type = "AttachPost";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  depth = DEPTHS.PREDRAW - 10;
  schema = AttachPostSchema;

  run(entity: number, gameModel: GameModel) {
    const AttachData = gameModel.getTyped(entity, AttachSchema);

    if (AttachData.parent != undefined) {
      if (!gameModel.isActive(AttachData.parent)) {
        AttachData.parent = null;
        return;
      }
      if (!gameModel.hasComponent(AttachData.parent, "Attached")) {
        gameModel.setComponent(AttachData.parent, "Attached", {
          children: [entity],
        });
      } else {
        const parentData = gameModel.getTyped(AttachData.parent, AttachedSchema);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
        }
      }

      if (AttachData.post) {
        let transformSchema = gameModel.getTyped(AttachData.parent, TransformSchema);
        const ownerPosition = transformSchema.position;

        transformSchema = gameModel.getTyped(entity, TransformSchema);
        transformSchema.x = ownerPosition.x;
        transformSchema.y = ownerPosition.y;

        if (AttachData.offset) {
          transformSchema.x += AttachData.offset.x;
          transformSchema.y += AttachData.offset.y;
        }
      }
    }
  }
}

registerSystem(AttachPostSystem);
