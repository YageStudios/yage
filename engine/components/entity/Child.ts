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
    const childData = gameModel.getTypedUnsafe(entity, ChildSchema);

    if (childData.parent == undefined && gameModel.hasComponent(entity, "Owner")) {
      const ownerData = gameModel.getComponentUnsafe(entity, "Owner");
      if (ownerData.owner != undefined) {
        childData.parent = ownerData.owner;
      }
    }
    if (childData.parent) {
      if (!gameModel.hasComponent(childData.parent, "Parent")) {
        gameModel.addComponent(childData.parent, "Parent", {
          children: [entity],
        });
      } else {
        const parentData = gameModel.getTypedUnsafe(childData.parent, ParentSchema);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
        }
      }

      const modIds = gameModel.getComponentIdsByCategory(childData.parent, ComponentCategory.ON_ADD_TO_PARENT);
      for (let i = 0; i < modIds.length; i++) {
        const mod = gameModel.getComponent(childData.parent, modIds[i]) as any;
        if (mod.parent !== undefined) {
          mod.parent = childData.parent;
        }
        if (mod.child !== undefined) {
          mod.child = entity;
        }

        const system: System = gameModel.getSystem(modIds[i]);
        system.run?.(childData.parent, gameModel);
      }

      if (childData.autoAttach) {
        const { autoAttach, ...attachData } = childData;
        gameModel.addComponent(entity, "Attach", {
          ...attachData,
        });
      }
    }
  }

  run(entity: number, gameModel: GameModel) {
    let modIds: number[] | undefined;
    const childData = gameModel.getTypedUnsafe(entity, ChildSchema);
    if (childData.parent != undefined) {
      if (!gameModel.isActive(childData.parent)) {
        childData.parent = null;
        return;
      }
      let checkAttach = false;
      if (!gameModel.hasComponent(childData.parent, "Parent")) {
        gameModel.addComponent(childData.parent, "Parent", {
          children: [entity],
        });
        checkAttach = true;
      } else {
        const parentData = gameModel.getTypedUnsafe(childData.parent, ParentSchema);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
          checkAttach = true;
        }
      }
      if (checkAttach) {
        modIds = modIds?.length
          ? modIds
          : gameModel.getComponentIdsByCategory(childData.parent, ComponentCategory.ON_ADD_TO_PARENT);
        for (let i = 0; i < modIds.length; i++) {
          const mod = gameModel.getComponent(childData.parent, modIds[i]) as any;
          if (mod.parent !== undefined) {
            mod.parent = childData.parent;
          }
          if (mod.child !== undefined) {
            mod.child = entity;
          }

          const system: System = gameModel.getSystem(modIds[i]);
          system.run?.(childData.parent, gameModel);
        }
      }
      if (checkAttach && childData.autoAttach) {
        const { autoAttach, ...attachData } = childData;
        gameModel.addComponent(entity, "Attach", {
          ...attachData,
        });
      }
    }
  }
}

registerSystem(ChildSystem);
