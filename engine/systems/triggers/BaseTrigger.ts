import { ComponentCategory } from "yage/systems/types";
import type { GameModel } from "yage/game/GameModel";
import { TriggerEventSystem } from "./TriggerEvent";
import { Transform } from "yage/schemas/entity/Transform";
import type { BaseTrigger } from "yage/schemas/triggers/BaseTrigger";
import { TriggerEvent } from "yage/schemas/triggers/TriggerEvent";
import { SystemImpl } from "minecs";
import { PixiSprite } from "yage/schemas/render/PixiSprite";

export abstract class BaseTriggerSystem extends SystemImpl<GameModel> {
  static depth = -1;
  static category: ComponentCategory = ComponentCategory.CORE;

  shouldTrigger(gameModel: GameModel, entity: number): false | number[] {
    const trigger = this.getTrigger(gameModel, entity);

    if (trigger.disableOnHidden) {
      let sprite;
      if (gameModel.hasComponent(PixiSprite, entity)) {
        sprite = gameModel.getTypedUnsafe(PixiSprite, entity);
      } else {
        return false;
      }
      if (sprite.opacity === 0) return false;
    }
    return gameModel.players;
  }

  triggerEvent(entity: number, triggerEntities: number[], trigger: BaseTrigger, gameModel: GameModel) {
    let triggered = false;
    const triggerEvent = trigger.triggerEvent;
    let inheritedLocation;
    if (trigger.triggerSourceEntity) {
      triggerEntities = [entity];
    }
    if (trigger.inheritLocation) {
      const transform = gameModel.getTypedUnsafe(Transform, entity);
      inheritedLocation = { x: transform.x, y: transform.y };
    }
    if (triggerEvent.length) {
      for (let i = 0; i < triggerEvent.length; i++) {
        const location = trigger.inheritLocation ? inheritedLocation : triggerEvent[i].location;
        gameModel.addComponent(TriggerEvent, entity, { ...triggerEvent[i], triggerEntities, location });
        triggered = gameModel.getSystem(TriggerEventSystem).run(gameModel, entity) || triggered;
      }
    } else {
      const triggerEvent = gameModel.getTypedUnsafe(TriggerEvent, entity);
      triggerEvent.triggerEntities = triggerEntities;
      if (trigger.inheritLocation && inheritedLocation) {
        triggerEvent.location = inheritedLocation;
      }
      triggered = gameModel.getSystem(TriggerEventSystem).run(gameModel, entity);
    }
    return triggered;
  }

  abstract getTrigger(gameModel: GameModel, entity: number): BaseTrigger;

  run = (gameModel: GameModel, entity: number) => {
    const trigger = this.getTrigger(gameModel, entity);
    const players = gameModel.players;

    if (players.length === 0) {
      return;
    }

    const validPlayers = this.shouldTrigger(gameModel, entity);
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
  };
}
