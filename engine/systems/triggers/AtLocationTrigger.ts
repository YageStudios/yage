import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { ComponentCategory } from "yage/systems/types";
import type { GameModel } from "yage/game/GameModel";
import { distanceSquaredVector2d } from "yage/utils/vector";
import { keyPressed } from "yage/utils/keys";
import { MappedKeys } from "yage/inputs/InputManager";
import { BaseTriggerSystem } from "./BaseTrigger";
import { Transform } from "yage/schemas/entity/Transform";
import { PixiSprite } from "yage/schemas/render/PixiSprite";
import { AtLocationTrigger } from "yage/schemas/triggers/AtLocationTrigger";
import { System, getSystem } from "minecs";
import { WorldSystem } from "../core/World";
import type { BaseTrigger } from "yage/schemas/triggers/BaseTrigger";
import { DEPTHS } from "yage/constants/enums";

@System(AtLocationTrigger)
export class AtLocationTriggerSystem extends BaseTriggerSystem {
  type = "AtLocationTrigger";
  category: ComponentCategory = ComponentCategory.TRIGGER;
  schema = AtLocationTrigger;
  depth = DEPTHS.COLLISION + 10;

  dependencies = ["Transform"];

  getTrigger(gameModel: GameModel, entity: number): BaseTrigger {
    return gameModel.getTypedUnsafe(AtLocationTrigger, entity);
  }

  shouldTrigger(gameModel: GameModel, entity: number): false | number[] {
    const trigger = gameModel.getTypedUnsafe(AtLocationTrigger, entity);

    if (trigger.disableOnHidden) {
      let sprite; //gameModel.getTypedUnsafe(entity, Sprite);
      if (gameModel.hasComponent(PixiSprite, entity)) {
        sprite = gameModel.getTypedUnsafe(PixiSprite, entity);
      } else {
        return false;
      }
      if (sprite.opacity === 0) return false;
    }

    let triggerLocation = trigger.location;
    if (!triggerLocation) {
      const transform = gameModel.getTypedUnsafe(Transform, entity);
      triggerLocation = {
        x: transform.x,
        y: transform.y,
      };
    } else {
      triggerLocation = { ...triggerLocation };
      triggerLocation.x += getSystem(gameModel, WorldSystem).toWorldSpace(gameModel, entity, triggerLocation.x);
    }
    const radiusSq = trigger.radius * trigger.radius;
    const innerRadiusSq = trigger.innerRadius * trigger.innerRadius;

    let entities: number[] = [];

    if (trigger.sourceDescription) {
      entities = gameModel.getEntityByDescription(trigger.sourceDescription) ?? [];
      if (trigger.inclusiveOfSource) {
        entities.push(...gameModel.players);
      }
    } else {
      entities = gameModel.players;
    }

    const shouldTrigger: number[] = [];

    for (let i = 0; i < entities.length; i++) {
      const player = entities[i];
      const playerTransform = gameModel.getTypedUnsafe(Transform, player);
      const distance = distanceSquaredVector2d(playerTransform, triggerLocation);

      let keyPressCheck = true;
      if (trigger.triggerOnUse) {
        const netData = gameModel.getTypedUnsafe(PlayerInput, player);
        keyPressCheck = keyPressed([MappedKeys.USE], netData.keyMap, netData.prevKeyMap);
      }

      if (distance < radiusSq && distance > innerRadiusSq && keyPressCheck) {
        shouldTrigger.push(player);
      } else if (trigger.triggerType === "ALLPLAYERS") {
        return false;
      }
    }

    return !!shouldTrigger.length && shouldTrigger;
  }
}

// class DebugAtLocationTrigger implements PixiDrawSystem {
//   schema = AtLocationTrigger;
//   ids: Set<number> = new Set();
//   entities: {
//     [id: number]: { container: PIXI.Container; radiusGraphic: PIXI.Graphics };
//   } = {};
//   debug = true;

//   // eslint-disable-next-line @typescript-eslint/no-empty-function
//   run: (entity: number, renderModel: RenderModel) => void = () => {};

//   init(entity: number, renderModel: RenderModel, viewport: Viewport) {
//     const container = new PIXI.Container();
//     container.zIndex = 100;
//     const trigger = renderModel.getTypedUnsafe(entity, AtLocationTrigger);

//     let triggerLocation = trigger.location;
//     if (!triggerLocation) {
//       Transform.id = entity;
//       triggerLocation = Transform.position;
//     }

//     if (trigger.innerRadius) {
//       const innerRadius = trigger.innerRadius;
//       const innerRadiusGraphic = new PIXI.Graphics();
//       innerRadiusGraphic.lineStyle(5, 0x00ff00);
//       innerRadiusGraphic.drawCircle(0, 0, innerRadius);

//       container.addChild(innerRadiusGraphic as any);
//     }

//     const radius = trigger.radius;
//     const radiusGraphic = new PIXI.Graphics();
//     radiusGraphic.lineStyle(5, 0xff0000);
//     radiusGraphic.drawCircle(0, 0, radius);

//     container.addChild(radiusGraphic as any);
//     container.zIndex = 100000;
//     container.position.set(triggerLocation.x, triggerLocation.y);

//     const entityObj: any = {
//       container,
//       radiusGraphic,
//     };

//     viewport.addChild(container as any);
//     this.entities[entity] = entityObj;
//     this.ids.add(entity);
//   }

//   cleanup(entity: number) {
//     if (!this.entities[entity]) {
//       return;
//     }
//     const container = this.entities[entity].container;
//     container.children.forEach((child) => {
//       container.removeChild(child);
//       child.destroy();
//     });

//     container.destroy();
//     delete this.entities[entity];
//     this.ids.delete(entity);
//   }
// }

// registerPixiComponent("AtLocationTrigger", DebugAtLocationTrigger);
