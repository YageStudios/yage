import { PlayerInputSchema } from "yage/schemas/core/PlayerInput";
import { DEPTHS, registerPixiComponent, registerSystem } from "yage/components/ComponentRegistry";
import type { PixiDrawSystem } from "yage/components/PixiDrawSystem";
import { ComponentCategory } from "yage/components/types";
import type { GameModel } from "yage/game/GameModel";
import { distanceSquaredVector2d } from "yage/utils/vector";
import * as PIXI from "pixi.js";
import { keyPressed } from "yage/utils/keys";
import { MappedKeys } from "yage/inputs/InputManager";
import { BaseTriggerSystem } from "./BaseTrigger";
import { TransformSchema } from "yage/schemas/entity/Transform";
import { SpriteSchema } from "yage/schemas/render/Sprite";
import { MapSpriteSchema } from "yage/schemas/render/MapSprite";
import type { Viewport } from "pixi-viewport";
import { AtLocationTriggerSchema } from "yage/schemas/triggers/AtLocationTrigger";
import { WorldSchema } from "yage/schemas/core/World";
import { WORLD_WIDTH } from "yage/constants";
import type { RenderModel } from "yage/game/RenderModel";

export class AtLocationTriggerSystem extends BaseTriggerSystem {
  type = "AtLocationTrigger";
  category: ComponentCategory = ComponentCategory.TRIGGER;
  schema = AtLocationTriggerSchema;
  depth = DEPTHS.COLLISION + 10;

  dependencies = ["Transform"];

  shouldTrigger(entity: number, gameModel: GameModel): false | number[] {
    const trigger = gameModel.getComponent(entity, this.type) as AtLocationTriggerSchema;

    if (trigger.disableOnHidden) {
      let sprite; //gameModel.getTypedUnsafe(entity, SpriteSchema);
      if (gameModel.hasComponent(entity, "Sprite")) {
        sprite = gameModel.getTypedUnsafe(entity, SpriteSchema);
      } else if (gameModel.hasComponent(entity, "MapSprite")) {
        sprite = gameModel.getTypedUnsafe(entity, MapSpriteSchema);
      } else {
        return false;
      }
      if (sprite.opacity === 0) return false;
    }

    let triggerLocation = trigger.location;
    if (!triggerLocation) {
      TransformSchema.id = entity;
      triggerLocation = TransformSchema.position;
    } else {
      triggerLocation = { ...triggerLocation };
      triggerLocation.x += WorldSchema.store.world[entity] * WORLD_WIDTH;
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
      TransformSchema.id = player;
      const position = TransformSchema.position;
      const distance = distanceSquaredVector2d(position, triggerLocation);

      let keyPressCheck = true;
      if (trigger.triggerOnUse) {
        const netData = gameModel.getTypedUnsafe(player, PlayerInputSchema);
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

registerSystem(AtLocationTriggerSystem);

class DebugAtLocationTrigger implements PixiDrawSystem {
  schema = AtLocationTriggerSchema;
  ids: Set<number> = new Set();
  entities: {
    [id: number]: { container: PIXI.Container; radiusGraphic: PIXI.Graphics };
  } = {};
  debug = true;

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  run: (entity: number, renderModel: RenderModel) => void = () => {};

  init(entity: number, renderModel: RenderModel, viewport: Viewport) {
    const container = new PIXI.Container();
    container.zIndex = 100;
    const trigger = renderModel.getTypedUnsafe(entity, AtLocationTriggerSchema);

    let triggerLocation = trigger.location;
    if (!triggerLocation) {
      TransformSchema.id = entity;
      triggerLocation = TransformSchema.position;
    }

    if (trigger.innerRadius) {
      const innerRadius = trigger.innerRadius;
      const innerRadiusGraphic = new PIXI.Graphics();
      innerRadiusGraphic.lineStyle(5, 0x00ff00);
      innerRadiusGraphic.drawCircle(0, 0, innerRadius);

      container.addChild(innerRadiusGraphic as any);
    }

    const radius = trigger.radius;
    const radiusGraphic = new PIXI.Graphics();
    radiusGraphic.lineStyle(5, 0xff0000);
    radiusGraphic.drawCircle(0, 0, radius);

    container.addChild(radiusGraphic as any);
    container.zIndex = 100000;
    container.position.set(triggerLocation.x, triggerLocation.y);

    const entityObj: any = {
      container,
      radiusGraphic,
    };

    viewport.addChild(container as any);
    this.entities[entity] = entityObj;
    this.ids.add(entity);
  }

  cleanup(entity: number) {
    if (!this.entities[entity]) {
      return;
    }
    const container = this.entities[entity].container;
    container.children.forEach((child) => {
      container.removeChild(child);
      child.destroy();
    });

    container.destroy();
    delete this.entities[entity];
    this.ids.delete(entity);
  }
}

registerPixiComponent("AtLocationTrigger", DebugAtLocationTrigger);
