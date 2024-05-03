// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="../../vendor/types/l1-path-finder.d.ts" />

import { PhysicsSystem } from "yage/systems/physics/Physics";
import { ComponentCategory } from "yage/systems/types";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import AssetLoader from "yage/loader/AssetLoader";
import type { TiledObjectLayer, TiledTileLayer } from "yage/types/Tiled";
import { addVector2d, scaleVector2d } from "yage/utils/vector";
import { cloneDeep } from "lodash";
import overview from "./overview";
import { flags } from "yage/console/flags";
import ImageLoader from "yage/loader/ImageLoader";
import type { ZindexCollider } from "yage/loader/MapLoader";
import * as PIXI from "pixi.js";
import { generate } from "yage/utils/rand";
import type { GenericArray, NdArray, TypedArray } from "ndarray";
import ndarray from "ndarray";
import type { Pathfinder } from "l1-path-finder";
import pathFinder from "l1-path-finder";
import { StringToEnum } from "yage/utils/typehelpers";
import { DEPTHS, EnemyTypeEnum } from "yage/constants/enums";
import RAPIER from "@dimforge/rapier2d-compat";
// @ts-ignore
import polyDecomp from "poly-decomp";
import MapLoader from "yage/loader/MapLoader";
import type { SBGameTrigger } from "yage/schemas/map/Map";
import { Map } from "yage/schemas/map/Map";
import { AtLocationTrigger } from "yage/schemas/triggers/AtLocationTrigger";
import { GlobalKillStatsTrigger } from "yage/schemas/triggers/GlobalKillStatsTrigger";
import { KillStatsTrigger } from "yage/schemas/triggers/KillStatsTrigger";
import { TimeTrigger } from "yage/schemas/triggers/TimeTrigger";
import { TriggerEvent } from "yage/schemas/triggers/TriggerEvent";
import { toWorldSpace } from "yage/utils/map";
import { TriggerEventSystem } from "yage/systems/triggers/TriggerEvent";
import { MapId } from "yage/schemas/map/MapSpawn";
import { WORLD_WIDTH } from "yage/constants";
import { DrawSystemImpl, System, SystemImpl, getSystem } from "minecs";
import { PixiViewportSystem } from "../render/PixiViewport";

const getTileName = (tile: number, skin: string) => {
  return overview[(tile - 1).toString() as unknown as keyof typeof overview].replace("$1", skin);
};

@System(Map)
export class MapSystem extends SystemImpl<GameModel> {
  static category = ComponentCategory.MAP;
  static depth = DEPTHS.CORE + 1;

  pathfinders: { [entity: number]: Pathfinder } = {};

  static previousPathfinders: { [entity: number]: Pathfinder } = {};

  getPathfinders(gameModel: GameModel, entity: number) {
    if (!this.pathfinders[entity]) {
      this.updatePathFinder(entity, this.generateMapArray(gameModel, entity));
    }
    return this.pathfinders[entity];
  }

  getSpawnPosition(gameModel: GameModel, mapId: number, spawnPoint: string) {
    const map = gameModel.getTypedUnsafe(Map, mapId);
    const mapData = AssetLoader.getInstance().getMap(map.map);

    const spawnTrigger = mapData.triggers.find((trigger) => trigger.name === spawnPoint && trigger.type === "SPAWN");
    if (!spawnTrigger) {
      throw new Error(`Spawn point ${spawnPoint} not found`);
    }
    return toWorldSpace(spawnTrigger, map.scale * 640);
  }

  processTriggers(gameModel: GameModel, mapId: number) {
    const map = gameModel.getTypedUnsafe(Map, mapId);
    const mapData = AssetLoader.getInstance().getMap(map.map);
    const triggers = mapData.triggers as SBGameTrigger[];

    // console.log(triggers);

    const triggerEventSystem = gameModel.getSystem(TriggerEventSystem);

    for (const trigger of triggers) {
      const overrideProperties = {
        ...trigger.properties,
        MapId: {
          mapId,
        },
      };
      const triggerEvent: TriggerEvent = {
        event: trigger.type,
        name: trigger.properties?.trigger?.name ?? trigger.name,
        location: scaleVector2d(toWorldSpace(trigger), map.scale * 640),
        overrideProperties: overrideProperties,
        components: trigger.components,
        width: trigger.width * map.scale,
        height: trigger.height * map.scale,
        triggerEntities: [],
        count: 0,
      };
      if (trigger.type === "CAMERABOUNDARY") {
        triggerEvent.width = scaleVector2d({ x: trigger.width, y: 0 }, map.scale * 640).x;
        triggerEvent.height = scaleVector2d({ x: 0, y: trigger.height }, map.scale * 640).y;
      }
      if (trigger.condition.type && trigger.condition.type !== "NONE") {
        const triggerEntity = gameModel.addEntity();
        gameModel.addComponent(MapId, triggerEntity, {
          mapId: mapId,
        });
        gameModel.addComponent(TriggerEvent, triggerEntity, triggerEvent);
        switch (trigger.condition.type) {
          case "KILLSTATS": {
            let killCount = 1;
            let enemyDescription = "";
            if (typeof trigger.condition.value === "number") {
              killCount = trigger.condition.value;
            } else if (typeof trigger.condition.value === "object") {
              killCount = trigger.condition.value?.killCount ?? 1;
              enemyDescription = trigger.condition.value?.enemyDescription ?? "";
            }
            const killStatsTrigger: Partial<KillStatsTrigger> = {
              description: enemyDescription,
              enemyType: StringToEnum(trigger.condition.key, EnemyTypeEnum) ?? EnemyTypeEnum.U_DEF,
              triggerType: trigger.condition.subType,
              triggerCount: killCount,
              locationType: trigger.condition.locationType,
              location: trigger.condition.location,
              destroyOnTrigger: trigger.condition.destroyOnTrigger ?? true,
            };
            gameModel.addComponent(KillStatsTrigger, triggerEntity, killStatsTrigger);
            break;
          }
          case "GLOBALKILLSTATS": {
            const globalkillStatsTrigger: Partial<GlobalKillStatsTrigger> = {
              enemyType: StringToEnum(trigger.condition.key, EnemyTypeEnum) ?? EnemyTypeEnum.U_DEF,
              triggerType: trigger.condition.subType,
              killCount: trigger.condition.value,
              locationType: trigger.condition.locationType,
              location: trigger.condition.location,
              destroyOnTrigger: trigger.condition.destroyOnTrigger ?? true,
            };
            gameModel.addComponent(GlobalKillStatsTrigger, triggerEntity, globalkillStatsTrigger);
            break;
          }
          case "ATLOCATION": {
            let radius = 1;
            let item = "NONE";
            let consumeItem = false;
            if (typeof trigger.condition.value === "number") {
              radius = trigger.condition.value;
            } else {
              radius = trigger.condition.value?.radius ?? 1;
              item = trigger.condition.value?.item ?? "NONE";
              consumeItem = trigger.condition.value?.consumeItem ?? false;
            }
            const atLocationTrigger: Partial<AtLocationTrigger> = {
              location: scaleVector2d(toWorldSpace(trigger), map.scale * 640),
              triggerType: trigger.condition.subType,
              destroyOnTrigger: trigger.condition.destroyOnTrigger,
              // item,
              radius,
              // consumeItem,
            };

            gameModel.addComponent(AtLocationTrigger, triggerEntity, atLocationTrigger);
            break;
          }
          case "TIME": {
            const timeTrigger: Partial<TimeTrigger> = {
              value: trigger.condition.value,
              triggerType: trigger.condition.subType,
              destroyOnTrigger: trigger.condition.destroyOnTrigger ?? true,
            };

            gameModel.addComponent(TimeTrigger, triggerEntity, timeTrigger);
            break;
          }
        }
      } else {
        triggerEventSystem.trigger(triggerEvent, gameModel);
      }
    }
  }

  init = (gameModel: GameModel, entity: number) => {
    const map = gameModel.getTypedUnsafe(Map, entity);

    this.updatePathFinder(entity, this.generateMapArray(gameModel, entity));
    map.shouldUpdatePath = false;

    this.processTriggers(gameModel, entity);
  };

  generateMapArray(gameModel: GameModel, entity: number) {
    const map = gameModel.getTypedUnsafe(Map, entity);
    const mapData = AssetLoader.getInstance().getMap(map.map);
    const skinData = AssetLoader.getInstance().getMapSkin(map.skin);

    const height = mapData.source.height;
    const width = mapData.source.width;
    const data = mapData.map.data;
    const physicsSystem = gameModel.getSystem(PhysicsSystem);
    const engine = physicsSystem.getEngine(gameModel);

    map.width = width;
    map.height = height;

    const mapArray = ndarray<any[]>(new Array(width * 20 * height * 20).fill(0), [width * 20, height * 20]);
    const worldOffset = gameModel.currentWorld * WORLD_WIDTH;

    for (let j = 0; j < height; ++j) {
      for (let i = 0; i < width; ++i) {
        const tileId = j * width + i;
        map.tileOffsets[tileId * 2] = 0;
        map.tileOffsets[tileId * 2 + 1] = 0;
        const tile = data[tileId];

        const size = 640 * map.scale;
        // const x = (i - j) * size;
        // const y = ((i + j) * size) / 2;
        const x = i * size;
        const y = j * size;

        if (tile !== 0) {
          const tileName = getTileName(tile, map.skin);

          map.tiles[tileId] = tileName;
          const wall = skinData.tiles[tileName];
          const collisionData = wall.layers.find((layer) => layer.name === "collision") as TiledObjectLayer;

          let furthestLeft = 0;
          let furthestUp = Infinity;

          const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x + worldOffset, y);
          const body = engine.createRigidBody(bodyDesc);

          collisionData.objects.forEach((object) => {
            if (object.polygon) {
              const vertices = cloneDeep(object.polygon).map((vertex) => {
                const pos = scaleVector2d(toWorldSpace(addVector2d(vertex, object)), map.scale);
                if (pos.x < furthestLeft) {
                  furthestLeft = pos.x;
                }
                if (pos.y < furthestUp) {
                  furthestUp = pos.y;
                }
                return pos;
              });

              const points = vertices.flat().map((v) => [v.x, v.y]);
              let decomp: number[][][] = [];
              if (polyDecomp.isSimple(points)) {
                polyDecomp.makeCCW(points);

                decomp = polyDecomp.quickDecomp(points);
              } else if (!decomp.length) {
                decomp.push(points);
              }

              decomp.forEach((pointSet) => {
                const pointsF32 = new Float32Array(pointSet.flat());
                const colliderDesc = RAPIER.ColliderDesc.convexHull(pointsF32);
                if (colliderDesc) {
                  physicsSystem.createCollider(-1, colliderDesc, body);
                }
              });
            }
            // );
          });

          // const pointsF32 = new Float32Array(points.flat());

          // const colliderDesc = RAPIER.ColliderDesc.convexHull(pointsF32);
          // if (colliderDesc) {
          //   console.log(colliderDesc);
          //   engine.createCollider(colliderDesc, body);
          // }

          const wallData = wall.layers.find((layer) => layer.name === "wall") as TiledTileLayer;
          if (wallData) {
            const xOffset = i * 20;
            const yOffset = j * 20;
            for (let y = 0; y < 20; ++y) {
              for (let x = 0; x < 20; ++x) {
                if (wallData.data[y * 20 + x]) {
                  // console.log(x, y);
                }
                mapArray.set(x + xOffset, y + yOffset, wallData.data[y * 20 + x] ? 1 : 0);
              }
            }
          }
        } else if (mapData.map.customTiles[tileId]) {
          const customTile = mapData.map.customTiles[tileId];
          map.tiles[tileId] = customTile.name;
          if (customTile.height !== 1 || customTile.width !== 1) {
            map.tileOffsets[tileId * 2] = customTile.width;
            map.tileOffsets[tileId * 2 + 1] = customTile.height;
            for (let k = 0; k < customTile.width; ++k) {
              for (let l = 0; l < customTile.height; ++l) {
                if (k === 0 && l === 0) {
                  continue;
                }
                // console.log("custom tile", tileId + k + l * width);
                map.tiles[tileId + k + l * width] = customTile.name;
                map.tileOffsets[(tileId + k + l * width) * 2] = -k;
                map.tileOffsets[(tileId + k + l * width) * 2 + 1] = -l;
              }
            }
          }
          let wall = skinData.tiles[customTile.name];
          if (customTile.name.startsWith("rooms")) {
            wall = MapLoader.getInstance().mapTiles[customTile.name];
          }
          const collisionData = wall.layers.find((layer) => layer.name === "collision") as TiledObjectLayer;

          let furthestLeft = 0;
          let furthestUp = Infinity;
          const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x + worldOffset, y);
          const body = engine.createRigidBody(bodyDesc);

          collisionData.objects.forEach((object) => {
            if (object.polygon) {
              const vertices = cloneDeep(object.polygon).map((vertex) => {
                const pos = scaleVector2d(toWorldSpace(addVector2d(vertex, object)), map.scale);
                if (pos.x < furthestLeft) {
                  furthestLeft = pos.x;
                }
                if (pos.y < furthestUp) {
                  furthestUp = pos.y;
                }
                return pos;
              });

              const points = vertices.flat().map((v) => [v.x, v.y]);
              let decomp: number[][][] = [];
              if (polyDecomp.isSimple(points)) {
                polyDecomp.makeCCW(points);
                decomp = polyDecomp.quickDecomp(points);
              } else if (!decomp.length) {
                decomp.push(points);
              }

              decomp.forEach((pointSet) => {
                const pointsF32 = new Float32Array(pointSet.flat());
                const colliderDesc = RAPIER.ColliderDesc.convexHull(pointsF32);
                if (colliderDesc) {
                  physicsSystem.createCollider(-1, colliderDesc, body);
                }
              });
            }
          });

          const wallData = wall.layers.find((layer) => layer.name === "wall") as TiledTileLayer;
          if (wallData) {
            const xOffset = i * 20;
            const yOffset = j * 20;
            for (let y = 0; y < customTile.height * 20; ++y) {
              for (let x = 0; x < customTile.width * 20; ++x) {
                if (wallData.data[y * 20 + x]) {
                  // console.log(x, y);
                }
                mapArray.set(x + xOffset, y + yOffset, wallData.data[y * 20 + x] ? 1 : 0);
              }
            }
          }
        } else if (!map.tiles[tileId]) {
          map.tiles[tileId] = "";
        }
      }
    }
    return mapArray;
  }

  updatePathFinder(entity: number, mapArray?: NdArray<number[] | TypedArray | GenericArray<number>>) {
    mapArray = mapArray ?? this.pathfinders[entity].map ?? [];
    this.pathfinders[entity] = pathFinder(mapArray);
    this.pathfinders[entity].map = mapArray;

    if (flags.DEBUG) {
      let mapString = "";
      for (let j = 0; j < mapArray.shape[1]; ++j) {
        for (let i = 0; i < mapArray.shape[0]; ++i) {
          mapString += mapArray.get(i, j);
        }
        mapString += "\n";
      }
    }
    MapSystem.previousPathfinders[entity] = this.pathfinders[entity];
  }

  run = (gameModel: GameModel, entity: number) => {
    const data = gameModel.getTypedUnsafe(Map, entity);
    if (data.shouldUpdatePath) {
      this.updatePathFinder(entity);
      data.shouldUpdatePath = false;
    }
  };

  cleanup = (gameModel: GameModel, entity: number) => {
    const entitiesInMap = gameModel.getComponentActives("MapId").filter((activeEntity) => {
      const mapId = gameModel.getTypedUnsafe(MapId, activeEntity).mapId;
      return mapId === entity;
    });
    console.log("CLEANING UP MAP", entitiesInMap);
    for (let i = 0; i < entitiesInMap.length; ++i) {
      gameModel.removeEntity(entitiesInMap[i]);
    }
  };
}

@System(Map)
class MapDrawPixiSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  ids: Set<number> = new Set();
  entities: {
    [key: number]: {
      minimap: PIXI.Container;
      map: PIXI.Container;
      colliders: PIXI.Container;
      walls: PIXI.Sprite[];
    };
  } = {};

  static zIndex: {
    [key: number]: {
      data: number[];
      zIndex: number;
    };
  } = [];

  schema = Map;

  init = (renderModel: ReadOnlyGameModel, entity: number) => {
    const viewport = getSystem(renderModel, PixiViewportSystem).viewport;
    const mapData = renderModel.getTypedUnsafe(Map, entity);
    const mapAsset = AssetLoader.getInstance().getMap(mapData.map);
    const skinData = AssetLoader.getInstance().getMapSkin(mapData.skin);
    const pathfinder = renderModel.getSystem(MapSystem).getPathfinders(renderModel, entity);
    const mapArray = pathfinder.map;

    const scale = mapData.scale;
    const rand = generate(123);

    const miniMap = new PIXI.Container();
    miniMap.zIndex = -10000;
    const map = new PIXI.Container();
    const wallsContainer = new PIXI.Container();
    map.sortableChildren = true;
    // Magic numbers
    map.scale.set(scale);
    const mapWidth = mapArray.shape[0];
    const mapHeight = mapArray.shape[1];
    const tileWidth = (640 / 20) * scale;
    const tileHeight = (640 / 20) * scale;
    map.position.set((-tileWidth * mapWidth) / 2, (-tileHeight * mapHeight) / 2);

    const xOffset = 0; //(-tileWidth * mapWidth) / 2;
    const yOffset = 0; //(-tileHeight * mapHeight) / 2;

    const collidersContainer = new PIXI.Container();
    const colliders = new PIXI.Container();
    // colliders.rotation = 45 * (Math.PI / 180);
    // collidersContainer.scale.set(Math.SQRT2, 0.5 * Math.SQRT2);
    collidersContainer.addChild(colliders);
    collidersContainer.zIndex = 100000;
    collidersContainer.visible = false;

    for (let i = 0; i < mapWidth; ++i) {
      for (let j = 0; j < mapHeight; ++j) {
        const hasTile = mapArray.get(i, j);
        if (hasTile) {
          const tile = new PIXI.Rectangle(i * tileWidth, j * tileHeight, tileWidth, tileHeight);
          colliders.addChild(new PIXI.Graphics().beginFill(0x000000).drawRect(tile.x, tile.y, tile.width, tile.height));
        }
      }
    }

    // const t = PixiSpriteLoader.getInstance().pixiSpriteLibrary.get("map/overview");
    // gameModel.gameCoordinator.currentScene.addChild(miniMap);
    viewport.addChild(map);
    viewport.addChild(wallsContainer);
    viewport.addChild(collidersContainer);

    const { width: width, height: height, data, customTiles } = mapAsset.map;
    // @ts-ignore
    // gameModel.gameCoordinator.currentScene.pixiApp.renderer.background.color = hexToRgbNumber(skinData.floor.baseColor);

    const walls: PIXI.Sprite[] = [];
    const worldOffset = renderModel.currentWorld * WORLD_WIDTH;

    wallsContainer.position.x = worldOffset;

    const flag = false;

    for (let i = 0; i < width; ++i) {
      for (let j = 0; j < height; ++j) {
        const tileKey = j * width + i;
        const tileId = data[tileKey];
        const tileWidth = 640;
        const x = i * tileWidth;
        const y = j * tileWidth;

        const floorTexture = ImageLoader.getInstance().getPixiTexture(`${mapData.skin}_floor_${rand.int(0, 4)}`);
        const floor = new PIXI.Sprite(floorTexture);

        floor.x = x;
        floor.y = y;
        map.addChild(floor);

        let tile = customTiles[tileKey]?.name || "";
        if (tileId !== 0 && !tile) {
          tile = getTileName(tileId, mapData.skin);
        }

        if (tile) {
          let wallData = skinData.tiles[tile];
          if (tile.startsWith("rooms")) {
            wallData = MapLoader.getInstance().mapTiles[tile];
          }

          const wallLayer = wallData.sprites;

          wallLayer.forEach(
            (sprite: {
              x: number;
              y: number;
              width: number;
              height: number;
              hFlip: boolean;
              vFlip: boolean;
              name: string;
              zIndexes: ZindexCollider[];
            }) => {
              if (sprite.zIndexes.length) {
                for (let i = 0; i < sprite.zIndexes.length; ++i) {
                  const zindexCollider = sprite.zIndexes[i];
                  const texture = ImageLoader.getInstance().getPixiTexture(sprite.name).baseTexture;
                  const texturePart = new PIXI.Texture(
                    texture,
                    new PIXI.Rectangle(zindexCollider.x, 0, zindexCollider.width, sprite.height)
                  );
                  const wall = new PIXI.Sprite(texturePart);
                  wall.anchor.set(0.5);
                  wall.scale.y = sprite.vFlip ? -scale : scale;
                  wall.scale.x = sprite.hFlip ? -scale : scale;
                  const zIndexX = sprite.hFlip
                    ? -zindexCollider.x + sprite.width - zindexCollider.width
                    : zindexCollider.x;
                  wall.x = (x + sprite.x + zIndexX + zindexCollider.width / 2) * scale + xOffset; //fromMapScale(sprite.x, mapData);
                  wall.y = (y + sprite.y + sprite.height / 2) * scale + yOffset; //fromMapScale(sprite.y, mapData);
                  wall.zIndex = 1; //(y + sprite.y + sprite.height / 2) * scale + yOffset + zindexCollider.y * scale * 0.33; // why one third?
                  // @ts-ignore
                  wall.originalZIndex = wall.zIndex;
                  wallsContainer.addChild(wall);
                  walls.push(wall);
                }
              } else {
                const wall = new PIXI.Sprite(ImageLoader.getInstance().getPixiTexture(sprite.name));
                wall.anchor.set(0.5);
                wall.scale.y = sprite.vFlip ? -scale : scale;
                wall.scale.x = sprite.hFlip ? -scale : scale;
                wall.x = (x + sprite.x + sprite.width / 2) * scale + xOffset;
                wall.y = (y + sprite.y + sprite.height / 2) * scale + yOffset;

                // console.log(x, y, wall.x, wall.y, scale);
                // wall.x = 0;
                // wall.y = 0;
                wallsContainer.addChild(wall);
              }
            }
          );
        }
      }
    }
    wallsContainer.zIndex = -10000;

    this.entities[entity] = { minimap: miniMap, map, colliders, walls };

    this.ids.add(entity);
  };
  run = (renderModel: ReadOnlyGameModel, entity: number) => {
    const viewport = getSystem(renderModel, PixiViewportSystem).viewport;
    const { colliders, minimap, walls } = this.entities[entity];
    colliders.visible = flags.DEBUG;
    minimap.visible = flags.DEBUG;
    const viewY = viewport.position.y;

    walls.forEach((wall) => {
      // console.log(wall.originalZIndex, wall.zIndex);
      // @ts-ignore
      wall.zIndex = wall.originalZIndex - viewY;
    });
  };
  cleanup = (_gameModel: ReadOnlyGameModel, entity: number) => {
    const { map, colliders, minimap, walls } = this.entities[entity];
    map.destroy();
    colliders.destroy();
    minimap.destroy();
    walls.forEach((wall) => {
      try {
        wall.destroy();
      } catch (e) {
        console.error("THIS NEEDS TO BE FIXED");
      }
    });
  };
}
