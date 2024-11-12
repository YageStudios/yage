import { SwapComponentsSystem } from "yage/systems/entity/SwapComponents";
import { ComponentCategory } from "yage/systems/types";
import { EntityFactory } from "yage/entity/EntityFactory";
import type { GameModel } from "yage/game/GameModel";
import { closestEntity } from "yage/utils/Collision";
import { TriggerEvent } from "yage/schemas/triggers/TriggerEvent";
import { System, SystemImpl } from "minecs";
import { Transform } from "yage/schemas/entity/Transform";
import { MapEntityType } from "yage/schemas/entity/Types";
import { SwapComponents } from "yage/schemas/entity/SwapComponents";
import { Portal } from "yage/schemas/player/Portal";
import { Teleport } from "yage/schemas/player/Teleport";

@System(TriggerEvent)
export class TriggerEventSystem extends SystemImpl<GameModel> {
  static depth: number = -1;
  static category: ComponentCategory = ComponentCategory.MAP;

  trigger(data: TriggerEvent, gameModel: GameModel) {
    switch (data.event) {
      case "MAPENTITY": {
        let entity: number;
        if (EntityFactory.getInstance().hasEntity(data.name)) {
          let location = { ...data.location };
          if (data.width || data.height) {
            location = {
              x: location.x + gameModel.rand.int(-data.width / 2, data.width / 2),
              y: location.y + gameModel.rand.int(-data.height / 2, data.height / 2),
            };
          }
          entity = EntityFactory.getInstance().generateEntity(gameModel, data.name, {
            Transform: location,
            ...data.overrideProperties,
          });
        } else {
          entity = gameModel.addEntity();
          gameModel.addComponent(Transform, entity, data.location);
        }
        gameModel.addComponent(MapEntityType, entity, {
          width: data.width,
          height: data.height,
        });
        if (data.components) {
          data.components.forEach((component) => {
            if (Object.keys(component).length === 2 && component.inherit !== undefined) {
              gameModel.addComponent(component.type, entity);
            } else {
              gameModel.addComponent(component.type, entity, component);
            }
          });
        }
        break;
      }
      case "CAMERABOUNDARY": {
        EntityFactory.getInstance().generateEntity(gameModel, "CameraBoundary", {
          Transform: { ...data.location },
          LineOfInterest: { x: data.width, y: data.height },
          ...data.overrideProperties,
        });
        break;
      }
      case "ENTITY": {
        for (let i = 0; i < (data.count || 1); i++) {
          let location = { ...data.location };
          if (data.width || data.height) {
            location = {
              x: location.x + gameModel.rand.int(-data.width / 2, data.width / 2),
              y: location.y + gameModel.rand.int(-data.height / 2, data.height / 2),
            };
          }
          const entity = EntityFactory.getInstance().generateEntity(gameModel, data.name, {
            Transform: location,
            ...data.overrideProperties,
          });
          if (data.components) {
            data.components.forEach((component) => {
              if (Object.keys(component).length === 2 && component.inherit !== undefined) {
                gameModel.addComponent(component.type, entity);
              } else {
                gameModel.addComponent(component.type, entity, component.data);
              }
            });
          }
        }
        break;
      }
      case "SWAPONCOMPONENTS":
      case "SWAPOFFCOMPONENTS": {
        const swapOn = data.event === "SWAPONCOMPONENTS";
        const entities = (!data.name && data.triggerEntities) || [
          closestEntity(
            gameModel,
            data.location,
            gameModel.getComponentActives(data.name[0].toUpperCase() + data.name.slice(1).toLowerCase() + "Type")
          ),
        ];
        if (
          !entities.some((entity) => {
            if (entity !== undefined) {
              if (gameModel.hasComponent(SwapComponents, entity)) {
                if (gameModel.getTypedUnsafe(SwapComponents, entity).swapped === !swapOn) {
                  gameModel.getSystem(SwapComponentsSystem).run(gameModel, entity);
                  return true;
                } else {
                  return false;
                }
              }
            }
          })
        ) {
          return false;
        }
        break;
      }
      case "GIVE": {
        data.triggerEntities.forEach((entity) => {
          gameModel.addComponent(data.name, entity, data.overrideProperties);
        });
        break;
      }
      case "TELEPORT": {
        data.triggerEntities.forEach((entity) => {
          if (data.name === "PlayerPortal") {
            const portalData = gameModel.getTypedUnsafe(Portal, entity);
            if (portalData.fromSave && data.name !== portalData.fromSave) {
              throw new Error("HANDLE INDIRECT PORTALING");
            }
            const portalSystem = gameModel.getSystemsByType("Portal")?.[0];
            portalSystem.run?.(gameModel, entity);
          } else {
            const [map, spawnPoint = ""] = data.name.split(".");
            gameModel.addComponent(Teleport, entity, {
              map,
              spawnPoint,
            });
            // const teleportSystem = gameModel.getSystem(TeleportSystem);
            // console.log("TELEPORTING");
            // teleportSystem.run(entity, gameModel);
          }
        });
        break;
      }
      case "MOVE": {
        // data.triggerEntities.forEach((entity) => {
        //   gameModel.addComponent(entity, "MoveOnMap", {
        //     location: data.name,
        //   });
        //   const moveOnMapSystem = gameModel.getSystem(MoveOnMapSystem);
        //   moveOnMapSystem.run(entity, gameModel);
        // });
        break;
      }
    }
    return true;
  }

  run = (gameModel: GameModel, entity: number) => {
    const data = gameModel.getTypedUnsafe(TriggerEvent, entity);
    if (!data.location) {
      const position = gameModel(Transform, entity);
      data.location = {
        x: position.x,
        y: position.y,
      };
    }
    return this.trigger(data, gameModel);
  };
}
