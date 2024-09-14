import type { System } from "yage/components/System";
import { ComponentCategory } from "yage/components/types";
import type { GameModel } from "yage/game/GameModel";
import { TriggerEventSystem } from "./TriggerEvent";
import { SpriteSchema } from "yage/schemas/render/Sprite";
import { MapSpriteSchema } from "yage/schemas/render/MapSprite";
import { TransformSchema } from "yage/schemas/entity/Transform";
import { BaseTriggerSchema } from "yage/schemas/triggers/BaseTrigger";
import { TriggerEventSchema } from "yage/schemas/triggers/TriggerEvent";

export class BaseTriggerSystem implements System {
  schema = BaseTriggerSchema;
  type = "BaseTrigger";
  category: ComponentCategory = ComponentCategory.CORE;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  shouldTrigger(entity: number, gameModel: GameModel): false | number[] {
    const trigger = gameModel.getComponent(entity, this.type) as BaseTriggerSchema;

    if (trigger.disableOnHidden) {
      let sprite;
      if (gameModel.hasComponent(entity, "Sprite")) {
        sprite = gameModel.getTypedUnsafe(entity, SpriteSchema);
      } else if (gameModel.hasComponent(entity, "MapSprite")) {
        sprite = gameModel.getTypedUnsafe(entity, MapSpriteSchema);
      } else {
        return false;
      }
      if (sprite.opacity === 0) return false;
    }
    return gameModel.players;
  }

  triggerEvent(entity: number, triggerEntities: number[], trigger: BaseTriggerSchema, gameModel: GameModel) {
    let triggered = false;
    const triggerEvent = trigger.triggerEvent;
    let inheritedLocation;
    if (trigger.triggerSourceEntity) {
      triggerEntities = [entity];
    }
    if (trigger.inheritLocation) {
      TransformSchema.id = entity;
      inheritedLocation = TransformSchema.position;
    }
    if (triggerEvent.length) {
      for (let i = 0; i < triggerEvent.length; i++) {
        const location = trigger.inheritLocation ? inheritedLocation : triggerEvent[i].location;
        gameModel.addComponent(entity, TriggerEventSchema, { ...triggerEvent[i], triggerEntities, location });
        triggered = gameModel.getSystem(TriggerEventSystem).run(entity, gameModel) || triggered;
      }
    } else {
      const triggerEvent = gameModel.getTypedUnsafe(entity, TriggerEventSchema);
      triggerEvent.triggerEntities = triggerEntities;
      if (trigger.inheritLocation && inheritedLocation) {
        triggerEvent.location = inheritedLocation;
      }
      triggered = gameModel.getSystem(TriggerEventSystem).run(entity, gameModel);
    }
    return triggered;
  }

  run(entity: number, gameModel: GameModel) {
    const trigger = gameModel.getComponent(entity, this.type) as BaseTriggerSchema;
    const players = gameModel.players;

    if (players.length === 0) {
      return;
    }

    const validPlayers = this.shouldTrigger(entity, gameModel);
    if (!validPlayers) {
      return;
    }
    if (validPlayers.length >= (trigger.triggerType === "ALLPLAYERS" ? players.length : 1)) {
      if (this.triggerEvent(entity, validPlayers, trigger, gameModel)) {
        if (trigger.destroyOnTrigger) {
          gameModel.removeEntity(entity);
        }
      }
    }
  }
}
