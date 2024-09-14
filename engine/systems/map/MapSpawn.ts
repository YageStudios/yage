import type { GameModel } from "yage/game/GameModel";
import { MapSystem } from "./Map";
import { EntityFactory } from "yage/entity/EntityFactory";
import { Transform } from "yage/schemas/entity/Transform";
import Description from "yage/schemas/core/Description";
import { MapSession } from "yage/schemas/map/MapSession";
import { MapId, MapSpawn } from "yage/schemas/map/MapSpawn";
import { World } from "yage/schemas/core/World";
import { Child } from "yage/schemas/entity/Child";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { System, SystemImpl } from "minecs";
import { ComponentCategory } from "yage/constants/enums";

@System(MapId)
export class MapIdSystem extends SystemImpl<GameModel> {
  static depth = -1;
  static category: ComponentCategory = ComponentCategory.MAP;

  init = (gameModel: GameModel, entity: number) => {
    const mapIdData = gameModel.getTyped(MapId, entity);

    if (mapIdData?.mapId === -1) {
      const mapIds = gameModel.getComponentActives("Map");
      const mapId: number | undefined = mapIds.find((mapId) => {
        return gameModel.getTypedUnsafe(Description, mapId).description === mapIdData.map;
      });
      if (mapId === undefined) {
        console.error("MapIdSystem: Map not found");
        return;
      }
      mapIdData.mapId = mapId;
    }
  };
}

const getEntityController = (gameModel: GameModel, entity: number) => {
  const parent = gameModel.getTypedUnsafe(Child, entity)?.parent;
  if (parent && gameModel.hasComponent(PlayerInput, parent)) {
    return parent;
  }
  return entity;
};

@System(MapSpawn, Transform)
export class MapSpawnSystem extends SystemImpl<GameModel> {
  static depth = -1;
  static category: ComponentCategory = ComponentCategory.MAP;

  init = (gameModel: GameModel, entity: number) => {
    const mapSpawn = gameModel.getTypedUnsafe(MapSpawn, entity);

    if (mapSpawn.unmountPreviousMap && gameModel.hasComponent(MapId, entity)) {
      const currentMapId = gameModel.getTypedUnsafe(MapId, entity).mapId;
      const playersInMap = gameModel.players.filter((player) => {
        return gameModel.hasComponent(MapId, player) && gameModel.getTypedUnsafe(MapId, player).mapId === currentMapId;
      });
      console.log(playersInMap, entity, gameModel.getTyped(MapId, entity));
      if (playersInMap.length === 1) {
        gameModel.removeComponent(MapId, entity);
        if (currentMapId && currentMapId !== -1) {
          console.log("REMOVING MAP", currentMapId);
          gameModel.removeEntity(currentMapId);
        }
      }
    }

    const mapIds = gameModel.getComponentActives("Map");
    let mapId: number | undefined = mapIds.find(
      (mapId) => gameModel.getTypedUnsafe(Description, mapId).description.toLowerCase() === mapSpawn.map.toLowerCase()
    );
    if (mapId === undefined) {
      gameModel.currentWorld = gameModel.createWorld();
      mapId = EntityFactory.getInstance().generateEntity(gameModel, mapSpawn.map);
    }
    const worldId = gameModel(World).store.world[mapId];
    gameModel.changeWorld(worldId, getEntityController(gameModel, entity));
    gameModel.currentWorld = worldId;

    mapSpawn.mapId = mapId;
    const mapName = mapSpawn.map;
    gameModel.addComponent(MapId, entity, { mapId, map: mapName });
    const mapSystem = gameModel.getSystem(MapSystem);
    let spawnPosition = {
      x: mapSpawn.spawnX,
      y: mapSpawn.spawnY,
    };
    if (mapSpawn.location !== "") {
      spawnPosition = mapSystem.getSpawnPosition(gameModel, mapId, mapSpawn.location);
    }
    console.log(spawnPosition);
    const transform = gameModel.getTypedUnsafe(Transform, entity);
    transform.x = spawnPosition.x;
    transform.y = spawnPosition.y;

    if (!gameModel.hasComponent(MapSession, entity)) {
      gameModel.addComponent(MapSession, entity);
    }
    const mapSession = gameModel.getTypedUnsafe(MapSession, entity);
    const sessionIndex = mapSession.maps.findIndex((sessionMap) => mapName === sessionMap);
    if (sessionIndex === -1) {
      mapSession.maps.push(mapName);
      mapSession.mapIds.push(mapId);
      mapSession.mapTimes.push(gameModel.timeElapsed);
    } else {
      mapSession.mapTimes[sessionIndex] = gameModel.timeElapsed;
      mapSession.mapIds[sessionIndex] = mapId;
    }

    gameModel.removeComponent(MapSpawn, entity);
  };
}
