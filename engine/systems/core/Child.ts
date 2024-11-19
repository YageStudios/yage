import type { GameModel } from "yage/game/GameModel";
import { ComponentCategory } from "../types";
import { Parent } from "../../schemas/entity/Parent";
import { Child } from "yage/schemas/entity/Child";
import { System, SystemImpl } from "minecs";
import { DEPTHS } from "yage/constants/enums";
import { Owner } from "yage/schemas/core/Owner";
import { Transform } from "yage/schemas/entity/Transform";
import { Attach } from "yage/schemas/entity/Attach";

@System(Child, Transform)
export class ChildSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.BEHAVIOR;
  static depth = DEPTHS.LOCOMOTION + 10;
  dependencies = ["Owner", "Transform", "Locomotion"];

  init = (gameModel: GameModel, entity: number) => {
    const childData = gameModel.getTypedUnsafe(Child, entity);

    if (childData.parent == undefined && gameModel.hasComponent("Owner", entity)) {
      const ownerData = gameModel.getTypedUnsafe(Owner, entity);
      if (ownerData.owner != undefined) {
        childData.parent = ownerData.owner;
      }
    }
    if (childData.parent) {
      if (!gameModel.hasComponent(Parent, childData.parent)) {
        gameModel.addComponent(Parent, childData.parent, {
          children: [entity],
        });
      } else {
        const parentData = gameModel.getTypedUnsafe(Parent, childData.parent);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
        }
      }

      gameModel.runMods(childData.parent, ComponentCategory.ON_ADD_TO_PARENT, {
        parent: childData.parent,
        child: entity,
      });

      if (childData.autoAttach) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { autoAttach: _, ...attachData } = childData;
        gameModel.addComponent(Attach, entity, {
          ...attachData,
        });
      }
    }
  };

  run = (gameModel: GameModel, entity: number) => {
    const childData = gameModel.getTypedUnsafe(Child, entity);
    if (childData.parent != undefined) {
      if (!gameModel.isActive(childData.parent)) {
        childData.parent = null;
        return;
      }
      let checkAttach = false;
      if (!gameModel.hasComponent(Parent, childData.parent)) {
        gameModel.addComponent(Parent, childData.parent, {
          children: [entity],
        });
        checkAttach = true;
      } else {
        const parentData = gameModel.getTypedUnsafe(Parent, childData.parent);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
          checkAttach = true;
        }
      }
      if (checkAttach) {
        gameModel.runMods(childData.parent, ComponentCategory.ON_ADD_TO_PARENT, {
          parent: childData.parent,
          child: entity,
        });
        if (childData.autoAttach) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { autoAttach: _, ...attachData } = childData;
          gameModel.addComponent(Attach, entity, {
            ...attachData,
          });
        }
      }
    }
  };

  cleanup(world: GameModel, eid: number): void {
    const childData = world.getTypedUnsafe(Child, eid);
    if (childData.parent) {
      const parentData = world.getTypedUnsafe(Parent, childData.parent);
      if (parentData) {
        const index = parentData.children.indexOf(eid);
        if (index !== -1) {
          parentData.children.splice(index, 1);
        }
      }
    }
  }
}
