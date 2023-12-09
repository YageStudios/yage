import { Component, Schema } from "../../decorators/type";
import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import { LocomotionSchema } from "../../schemas/entity/Locomotion";
import type { System } from "../System";
import { ComponentCategory } from "../types";
import { ParentSchema } from "../../schemas/entity/Parent";
import { TransformSchema } from "@/schemas/entity/Transform";
import { ChildSchema } from "@/schemas/entity/Child";

@Component("ChildPost")
export class ChildPostSchema extends Schema {}

class ChildSystem implements System {
  type = "Child";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = ChildSchema;
  depth = DEPTHS.LOCOMOTION + 10;
  dependencies = ["Owner", "Transform", "Locomotion"];

  init(entity: number, gameModel: GameModel) {
    if (!gameModel.hasComponent(entity, "ChildPost")) {
      gameModel.setComponent(entity, "ChildPost");
    }
    const childData = gameModel.getTyped(entity, ChildSchema);

    if (childData.parent == undefined && gameModel.hasComponent(entity, "Owner")) {
      const ownerData = gameModel.getComponent(entity, "Owner");
      if (ownerData.owner != undefined) {
        childData.parent = ownerData.owner;
      }
    }
  }

  run(entity: number, gameModel: GameModel) {
    const childData = gameModel.getTyped(entity, ChildSchema);
    if (childData.parent != undefined) {
      if (!gameModel.isActive(childData.parent)) {
        childData.parent = null;
        return;
      }
      if (!gameModel.hasComponent(childData.parent, "Parent")) {
        gameModel.setComponent(childData.parent, "Parent", {
          children: [entity],
        });
      } else {
        const parentData = gameModel.getTyped(childData.parent, ParentSchema);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
        }
      }

      let transformSchema = gameModel.getTyped(childData.parent, TransformSchema);
      const ownerPosition = transformSchema.position;

      transformSchema = gameModel.getTyped(entity, TransformSchema);
      transformSchema.x = ownerPosition.x;
      transformSchema.y = ownerPosition.y;

      if (childData.offset) {
        transformSchema.x += childData.offset.x;
        transformSchema.y += childData.offset.y;
      }

      if (
        childData.direction &&
        gameModel.hasComponent(entity, "Locomotion") &&
        gameModel.hasComponent(childData.parent, "Locomotion")
      ) {
        let locomotionSchema = gameModel.getTyped(childData.parent, LocomotionSchema);
        const parentDirectionX = locomotionSchema.directionX;
        const parentDirectionY = locomotionSchema.directionY;

        locomotionSchema = gameModel.getTyped(entity, LocomotionSchema);
        locomotionSchema.directionX = parentDirectionX;
        locomotionSchema.directionY = parentDirectionY;
      }
    }
  }
}

registerSystem(ChildSystem);

class ChildPostSystem implements System {
  type = "ChildPost";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  depth = DEPTHS.PREDRAW + 10;
  schema = ChildPostSchema;

  run(entity: number, gameModel: GameModel) {
    const childData = gameModel.getTyped(entity, ChildSchema);

    if (childData.parent != undefined) {
      if (!gameModel.isActive(childData.parent)) {
        childData.parent = null;
        return;
      }
      if (!gameModel.hasComponent(childData.parent, "Parent")) {
        gameModel.setComponent(childData.parent, "Parent", {
          children: [entity],
        });
      } else {
        const parentData = gameModel.getTyped(childData.parent, ParentSchema);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
        }
      }

      if (childData.post) {
        let transformSchema = gameModel.getTyped(childData.parent, TransformSchema);
        const ownerPosition = transformSchema.position;

        transformSchema = gameModel.getTyped(entity, TransformSchema);
        transformSchema.x = ownerPosition.x;
        transformSchema.y = ownerPosition.y;

        if (childData.offset) {
          transformSchema.x += childData.offset.x;
          transformSchema.y += childData.offset.y;
        }
      }
    }
  }
}

registerSystem(ChildPostSystem);
