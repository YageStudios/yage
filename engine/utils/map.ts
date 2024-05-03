import type { Vector2d } from "yage/utils/vector";
import { rotateDegVector2d, scaleVector2d } from "yage/utils/vector";
import type { GameModel } from "yage/game/GameModel";
import { Map } from "yage/schemas/map/Map";
import { MapId } from "yage/schemas/map/MapSpawn";

export const toWorldSpace = (position: Vector2d, scale = 1): Vector2d => {
  return scaleVector2d(position, scale);
};

export const toIsoWorldSpace = (position: Vector2d, scale = 1): Vector2d => {
  const transformedPosition = rotateDegVector2d(position, 45);
  transformedPosition.x *= Math.SQRT2;
  transformedPosition.y *= 0.5 * Math.SQRT2;
  return scaleVector2d(transformedPosition, scale);
};

export const fromMapScale = (val: number, mapData: Map) => {
  return val * mapData.scale * 640;
};

export const toMapSpace = (position: Vector2d, isometric = false): Vector2d => {
  if (!isometric) {
    return position;
  }

  let transformedPosition = { ...position };

  transformedPosition.x /= Math.SQRT2 * 2;
  transformedPosition.y /= Math.SQRT2;
  transformedPosition = rotateDegVector2d(transformedPosition, -45);
  transformedPosition.y *= 2;
  transformedPosition.x *= 2;

  return transformedPosition;
};

export const getMap = (entity: number, gameModel: GameModel) => {
  const targetMap = gameModel.getTyped(MapId, entity)?.mapId;

  if (targetMap === -1 || !targetMap) {
    return [];
  }

  const mapSchema = gameModel.getTyped(Map, targetMap);
  if (!mapSchema) {
    return [];
  }

  return [mapSchema, targetMap] as const;
};
