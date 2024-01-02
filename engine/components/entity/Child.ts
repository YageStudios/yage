import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import type { System } from "../System";
import { ComponentCategory } from "../types";
import { ParentSchema } from "../../schemas/entity/Parent";
import { ChildSchema } from "@/schemas/entity/Child";

class ChildSystem implements System {
  type = "Child";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;
  schema = ChildSchema;
  depth = DEPTHS.LOCOMOTION + 10;
  dependencies = ["Owner", "Transform", "Locomotion"];

  init(entity: number, gameModel: GameModel) {
    const childData = gameModel.getTyped(entity, ChildSchema);

    if (childData.parent == undefined && gameModel.hasComponent(entity, "Owner")) {
      const ownerData = gameModel.getComponent(entity, "Owner");
      if (ownerData.owner != undefined) {
        childData.parent = ownerData.owner;
      }
    }
    if (childData.parent && childData.autoAttach) {
      const { autoAttach, ...attachData } = childData;
      gameModel.setComponent(entity, "Attach", {
        ...attachData,
      });
    }
  }

  run(entity: number, gameModel: GameModel) {
    const childData = gameModel.getTyped(entity, ChildSchema);
    if (childData.parent != undefined) {
      if (!gameModel.isActive(childData.parent)) {
        childData.parent = null;
        return;
      }
      let checkAttach = false;
      if (!gameModel.hasComponent(childData.parent, "Parent")) {
        gameModel.setComponent(childData.parent, "Parent", {
          children: [entity],
        });
        checkAttach = true;
      } else {
        const parentData = gameModel.getTyped(childData.parent, ParentSchema);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
          checkAttach = true;
        }
      }
      if (checkAttach && childData.autoAttach) {
        const { autoAttach, ...attachData } = childData;
        gameModel.setComponent(entity, "Attach", {
          ...attachData,
        });
      }
    }
  }
}

registerSystem(ChildSystem);
