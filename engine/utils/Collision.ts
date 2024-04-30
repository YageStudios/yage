import type { GameModel } from "yage/game/GameModel";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { Radius } from "yage/schemas/entity/Radius";
import { Transform } from "yage/schemas/entity/Transform";
import { Collisions } from "yage/schemas/physics/Collisions";
import type { Vector2d } from "./vector";
import { distanceSquaredVector2d, lengthVector2d } from "./vector";

const emptyArray: number[] = [];

export interface SpatialMap<T> {
  cellSize: number;
  hash: { [hash: string]: T[] };
  hasEntities: boolean;
}

export const checkCollisionFilter = (entity: number, filter: number, gameModel: GameModel) => {
  const collisions = gameModel.getTypedUnsafe(Collisions, gameModel.coreEntity);

  if (
    !collisions.collisions[entity] ||
    !collisions.collisions[entity].filters ||
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    !collisions.collisions[entity].filters![filter]
  ) {
    return emptyArray;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return collisions.collisions[entity].filters![filter];
};

const pointsInSpatialMap = (cellSize: number, position: Vector2d, radius = 0, stretchPoint?: Vector2d): Set<string> => {
  let left = Math.floor((position.x - radius) / cellSize);
  let right = Math.floor((position.x + radius) / cellSize);
  let top = Math.floor((position.y - radius) / cellSize);
  let bottom = Math.floor((position.y + radius) / cellSize);

  if (stretchPoint) {
    left = Math.min(left, Math.floor((stretchPoint.x - radius) / cellSize));
    right = Math.max(right, Math.floor((stretchPoint.x + radius) / cellSize));
    top = Math.min(top, Math.floor((stretchPoint.y - radius) / cellSize));
    bottom = Math.max(bottom, Math.floor((stretchPoint.y + radius) / cellSize));
  }

  const pointSet: Set<string> = new Set();

  for (let x = left; x <= right; x++) {
    for (let y = top; y <= bottom; y++) {
      pointSet.add(`${x}-${y}`);
    }
  }
  return pointSet;
};

export const fromSpatialMap = (position: Vector2d, map: SpatialMap<number>, radius: number, filter?: number) => {
  const pointSet = pointsInSpatialMap(map.cellSize, position, radius);
  const result: Set<number> = new Set();
  if (filter) {
    pointSet.forEach((point) => {
      if (map.hash[point]) {
        map.hash[point].forEach((e) => e !== filter && result.add(e));
      }
    });
  } else {
    pointSet.forEach((point) => {
      if (map.hash[point]) {
        map.hash[point].forEach((e) => result.add(e));
      }
    });
  }
  return Array.from(result);
};

export const circleCircleVector2d = (origin1: Vector2d, radius1: number, origin2: Vector2d, radius2: number) => {
  return circleCircleCollision(origin1.x, origin1.y, radius1, origin2.x, origin2.y, radius2);
};

export const circleCircleCollision = (x1: number, y1: number, r1: number, x2: number, y2: number, r2: number) => {
  const r = r1 + r2;
  const dx = x1 - x2;
  const dy = y1 - y2;
  return r * r > dx * dx + dy * dy;
};

export const spatialMap = (
  gameModel: GameModel,
  entities: number[],
  cellSize: number,
  pointSets: { [eid: number]: Set<string> }
): SpatialMap<number> => {
  const map: SpatialMap<number> = {
    cellSize,
    hash: {},
    hasEntities: entities.length > 0,
  };
  for (let i = 0; i < entities.length; i++) {
    const transform = gameModel.getTypedUnsafe(Transform, entities[i]);
    const position = transform;

    let radius = gameModel(Radius, entities[i]).radius;
    if (!radius) {
      continue;
    }
    const locomotion = gameModel.getTypedUnsafe(Locomotion, entities[i]);
    const speed = lengthVector2d(locomotion);
    radius += speed;
    const stretchPoint = undefined;
    const pointSet = pointsInSpatialMap(cellSize, position, radius, stretchPoint);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    pointSets![entities[i]] = pointSet;
    pointSet.forEach((point) => {
      if (!map.hash[point]) {
        map.hash[point] = [];
      }
      map.hash[point].push(entities[i]);
    });
  }
  return map;
};

export const fastEntityCollision = (gameModel: GameModel, entity: number, player: number, radius: number) => {
  let transform = gameModel.getTypedUnsafe(Transform, entity);
  const position = transform;
  transform = gameModel.getTypedUnsafe(Transform, player);
  const playerPosition = transform;
  const playerRadius = gameModel(Radius, player).radius;
  return circleCircleVector2d(position, radius, playerPosition, playerRadius);
};

export const sortedByDistance = (
  gameModel: GameModel,
  entityPosition: Vector2d,
  entities: number[],
  maxRadius = Infinity
) => {
  const distances: { [key: number]: number } = {};
  const radiusSquared = maxRadius * maxRadius;
  if (entities.length === 1 && maxRadius < Infinity) {
    const transform = gameModel.getTypedUnsafe(Transform, entities[0]);
    const distance = distanceSquaredVector2d(entityPosition, transform);
    if (distance < radiusSquared) {
      return entities;
    }
    return [];
  }
  return entities
    .sort((a, b) => {
      if (!distances[a]) {
        const transform = gameModel.getTypedUnsafe(Transform, a);
        const distance = distanceSquaredVector2d(entityPosition, transform);
        if (distance < radiusSquared) {
          distances[a] = distance;
        } else {
          distances[a] = Infinity;
        }
      }
      if (!distances[b]) {
        const transform = gameModel.getTypedUnsafe(Transform, b);

        const distance = distanceSquaredVector2d(entityPosition, transform);
        if (distance < radiusSquared) {
          distances[b] = distance;
        } else {
          distances[b] = Infinity;
        }
      }
      return distances[a] - distances[b];
    })
    .filter((e) => distances[e] !== Infinity);
};

export const closestEntity = (
  gameModel: GameModel,
  entityPosition: Vector2d,
  entities: number[],
  radius = Infinity
): number | undefined => {
  return sortedByDistance(gameModel, entityPosition, entities, radius)[0];
};
