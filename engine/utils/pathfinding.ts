import { Pathfinder } from "l1-path-finder";
import { GameModel } from "yage/game/GameModel";
import { MapSystem } from "yage/systems/map/Map";
import { toWorldSpace, toMapSpace } from "./map";
import { Vector2d, addVector2d } from "./vector";
import { Map, MapIsometric } from "yage/schemas/map/Map";
import { MapId } from "yage/schemas/map/MapSpawn";
import { Transform } from "yage/schemas/entity/Transform";

const fastPlotLine = (x0: number, y0: number, x1: number, y1: number): number[] => {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  const points = [];
  while (true) {
    points.push(x0, y0);

    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err = err - dy;
      x0 = x0 + sx;
    }
    if (e2 < dx) {
      err = err + dx;
      y0 = y0 + sy;
    }
  }
  return points;
};

const skew = (v: Vector2d, mapWidth: number) => {
  const x = v.x;
  const y = v.y;
  return {
    x: x - y + mapWidth * 20 - 1,
    y: x + y,
  };
};

const unskew = (v: Vector2d, mapWidth: number) => {
  const x = (v.x - (mapWidth * 20 - 1) + v.y) / 2;
  const y = v.y - x;
  return {
    x,
    y,
  };
};

export const getMapPosition = (mapData: Map, position: Vector2d, step = 1): Vector2d => {
  const tileX = position.x / (mapData.scale * 640);
  const tileY = position.y / (mapData.scale * 640);
  return {
    x: Math.floor(tileX * step),
    y: Math.floor(tileY * step),
  };
};

export const getWorldPosition = (mapData: Map, position: Vector2d, step = 1): Vector2d => {
  const tileX = position.x / step;
  const tileY = position.y / step;
  return {
    x: Math.floor(tileX * (640 * mapData.scale)),
    y: Math.floor(tileY * (640 * mapData.scale)),
  };
};

export const fromPath = (map: Map, path: number[], index: number) => {
  const x = path[index * 2] + 0.5;
  const y = path[index * 2 + 1] + 0.5;
  const position = { x, y };
  return toWorldSpace(getWorldPosition(map, position, 20));
};

export const getPath = (pathFinder: Pathfinder, src: Vector2d, target: Vector2d, map: Map) => {
  const mapSrc = getMapPosition(map, toMapSpace(src), 20);
  const mapTarget = getMapPosition(map, toMapSpace(target), 20);
  const skewedPosition = skew(mapSrc, map.width);
  const skewedTargetPosition = skew(mapTarget, map.width);

  const line = fastPlotLine(mapSrc.x, mapSrc.y, mapTarget.x, mapTarget.y);

  let noColliders = true;
  for (let i = 0; i < line.length; i += 2) {
    if (pathFinder.map.get(line[i], line[i + 1]) === 1) {
      noColliders = false;
      break;
    }
  }

  if (noColliders) {
    const mapPos = getMapPosition(map, toMapSpace(target), 20);
    return [mapPos.x, mapPos.y];
  }
  const path: any[] = [];

  pathFinder.search(skewedPosition.x, skewedPosition.y, skewedTargetPosition.x, skewedTargetPosition.y, path);
  if (path.length > 0) {
    if (path.length > 2) {
      path.shift();
      path.shift();
    }
    // console.log(path);

    // if (path.length >= 6) {
    //   const secondToLastX = path[path.length - 6];
    //   const secondToLastY = path[path.length - 5];
    //   const lastX = path[path.length - 4];
    //   const lastY = path[path.length - 3];
    //   const targetX = path[path.length - 2];
    //   const targetY = path[path.length - 1];
    //   const line = plotLine(secondToLastX, secondToLastY, targetX, targetY);
    //   let noColliders = true;
    //   for (let i = 0; i < line.length; i += 2) {
    //     if (pathFinder.map.get(line[i], line[i + 1]) === 1) {
    //       noColliders = false;
    //       break;
    //     }
    //   }
    //   if (noColliders) {
    //     path[path.length - 4] = targetX;
    //     path[path.length - 3] = targetY;
    //     path.pop();
    //     path.pop();
    //   }
    // }
    const chasePath = [];
    for (let i = 0; i < path.length; i += 2) {
      let x = path[i];
      let y = path[i + 1];

      if (i < path.length - 4) {
        const nextX = path[i + 2];
        const nextY = path[i + 3];
        const distance = Math.abs(x - nextX) + Math.abs(y - nextY);
        if (distance < 2) {
          // merge points
          x = (x + nextX) / 2;
          y = (y + nextY) / 2;
          i += 2;
        }
      }

      const v = unskew({ x, y }, map.width);
      chasePath.push(v.x);
      chasePath.push(v.y);
    }
    return chasePath;
  }
};

export const makePickupable = (gameModel: GameModel, position: Vector2d) => {
  const players = gameModel.players;
  if (players.length === 0) {
    return position;
  }
  const target = players[0];
  const targetMap = gameModel.getTyped(MapId, target)?.mapId;
  if (!targetMap) {
    return position;
  }
  const map = gameModel.getTypedUnsafe(Map, targetMap);
  const mapSystem = gameModel.getSystem(MapSystem);
  const transform = gameModel.getTypedUnsafe(Transform, target);

  const targetPosition = { x: transform.x, y: transform.y };

  return _makePickupable(mapSystem.getPathfinders(gameModel, targetMap), position, targetPosition, map);
};

export const _makePickupable = (
  pathFinder: Pathfinder,
  desiredPoint: Vector2d,
  closestPlayer: Vector2d,
  map: Map
): Vector2d | undefined => {
  const mapSrc = getMapPosition(map, toMapSpace(desiredPoint), 20);
  const mapTarget = getMapPosition(map, toMapSpace(closestPlayer), 20);
  const directionOffset = { x: 0, y: 0 }; // scaleVector2d(normalizeVector2d(subtractVector2d(desiredPoint, closestPlayer)), 0.5);

  let line = fastPlotLine(mapSrc.x, mapSrc.y, mapTarget.x, mapTarget.y);

  console.log(mapSrc, mapTarget, line);

  if (line[0] === mapSrc.x && line[1] === mapSrc.y) {
    line = line.reverse();
  }

  let furthestPrecollisionPoint: Vector2d | undefined;
  for (let i = 0; i < line.length; i += 2) {
    if (pathFinder.map.get(line[i + 1], line[i]) === 1) {
      if (i === 0) {
        furthestPrecollisionPoint = { x: line[i + 1], y: line[i] };
      } else {
        furthestPrecollisionPoint = { x: line[i - 1], y: line[i - 2] };
      }
      furthestPrecollisionPoint = addVector2d(furthestPrecollisionPoint, directionOffset);
      break;
    }
  }
  if (!furthestPrecollisionPoint) {
    return desiredPoint;
  }

  return toWorldSpace(getWorldPosition(map, furthestPrecollisionPoint, 20));
};
