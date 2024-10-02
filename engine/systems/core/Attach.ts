import type { GameModel } from "yage/game/GameModel";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { ComponentCategory } from "yage/systems/types";
import { Transform } from "yage/schemas/entity/Transform";
import { Attach, AttachPost } from "yage/schemas/entity/Attach";
import { Attached } from "yage/schemas/entity/Attached";
import { System, SystemImpl } from "minecs";
import { DEPTHS } from "yage/constants/enums";
import { Owner } from "yage/schemas/core/Owner";

@System(Attach, Transform)
export class AttachSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.BEHAVIOR;
  static depth = DEPTHS.LOCOMOTION + 10;

  dependencies = ["Owner", "Transform", "Locomotion"];

  init = (gameModel: GameModel, entity: number) => {
    if (!gameModel.hasComponent(AttachPost, entity)) {
      gameModel.addComponent(AttachPost, entity);
    }
    const AttachData = gameModel.getTypedUnsafe(Attach, entity);

    if (gameModel.hasComponent(Owner, entity)) {
      const ownerData = gameModel.getTypedUnsafe(Owner, entity);
      if (ownerData.owner != undefined) {
        AttachData.parent = ownerData.owner;
      }
    }
  };

  run = (gameModel: GameModel, entity: number) => {
    const AttachData = gameModel.getTypedUnsafe(Attach, entity);
    if (AttachData.parent != undefined) {
      if (!gameModel.isActive(AttachData.parent)) {
        AttachData.parent = null;
        return;
      }
      if (!gameModel.hasComponent(Attached, AttachData.parent)) {
        gameModel.addComponent(Attached, AttachData.parent, {
          children: [entity],
        });
      } else {
        const parentData = gameModel.getTypedUnsafe(Attached, AttachData.parent);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
        }
      }

      let transform = gameModel.getTypedUnsafe(Transform, AttachData.parent);
      const ownerPosition = transform;

      transform = gameModel.getTypedUnsafe(Transform, entity);
      transform.x = ownerPosition.x;
      transform.y = ownerPosition.y;

      if (AttachData.offset) {
        transform.x += AttachData.offset.x;
        transform.y += AttachData.offset.y;
      }

      if (
        AttachData.direction &&
        gameModel.hasComponent("Locomotion", entity) &&
        gameModel.hasComponent("Locomotion", AttachData.parent)
      ) {
        let locomotion = gameModel.getTypedUnsafe(Locomotion, AttachData.parent);
        const parentDirectionX = locomotion.directionX;
        const parentDirectionY = locomotion.directionY;

        locomotion = gameModel.getTypedUnsafe(Locomotion, entity);
        locomotion.directionX = parentDirectionX;
        locomotion.directionY = parentDirectionY;
      }
    } else if (AttachData.parent == undefined && gameModel.hasComponent(Owner, entity)) {
      const ownerData = gameModel.getTypedUnsafe(Owner, entity);
      if (ownerData.owner != undefined) {
        AttachData.parent = ownerData.owner;
      }
    }
  };
}

@System(Attach, AttachPost)
export class AttachPostSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.BEHAVIOR;
  static depth = DEPTHS.PREDRAW - 10;

  run = (gameModel: GameModel, entity: number) => {
    const AttachData = gameModel.getTypedUnsafe(Attach, entity);

    if (AttachData.parent != undefined) {
      if (!gameModel.isActive(AttachData.parent)) {
        AttachData.parent = null;
        return;
      }
      if (!gameModel.hasComponent("Attached", AttachData.parent)) {
        gameModel.addComponent("Attached", AttachData.parent, {
          children: [entity],
        });
      } else {
        const parentData = gameModel.getTypedUnsafe(Attached, AttachData.parent);
        if (parentData.children.indexOf(entity) == -1) {
          parentData.children.push(entity);
        }
      }

      if (AttachData.post) {
        let transform = gameModel.getTypedUnsafe(Transform, AttachData.parent);
        const ownerPosition = transform;

        transform = gameModel.getTypedUnsafe(Transform, entity);
        transform.x = ownerPosition.x;
        transform.y = ownerPosition.y;

        if (AttachData.offset) {
          transform.x += AttachData.offset.x;
          transform.y += AttachData.offset.y;
        }
      }
    }
  };
}
