import { Component, DrawSystemImpl, getSystem, Schema, System, SystemImpl, type } from "minecs";
import { DEPTHS } from "yage/constants/enums";
import { EntityFactory } from "yage/entity/EntityFactory";
import { GameInstance } from "yage/game/GameInstance";
import { GameModel } from "yage/game/GameModel";
import { MappedKeys } from "yage/inputs/InputManager";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { MapId } from "yage/schemas/map/MapSpawn";
import { keyDown } from "yage/utils/keys";
import { getMapPosition, makePickupable } from "yage/utils/pathfinding";
import { Vector2d } from "yage/utils/vector";
import * as PIXI from "pixi.js";
import { PixiViewportSystem } from "yage/systems/render/PixiViewport";
import { Transform } from "yage/schemas/entity/Transform";
import { toMapSpace } from "yage/utils/map";
import { MapSystem } from "yage/systems/map/Map";
import { Map, MapIsometric } from "yage/schemas/map/Map";

@Component()
export class SpawnBallOnQ extends Schema {
  @type("string")
  roomId: string;
}

@System(SpawnBallOnQ)
export class SpawnBallOnQSystem extends SystemImpl<GameModel> {
  static depth = DEPTHS.PLAYER_MOVEMENT;

  run(gameModel: GameModel, entity: number) {
    const netData = gameModel.getTypedUnsafe(PlayerInput, entity);

    if (keyDown([MappedKeys.USE], netData.keyMap)) {
      console.log({ ...gameModel.getTypedUnsafe(Transform, entity) });

      // const targetMap = gameModel.getTyped(MapId, entity)?.mapId;
      // if (!targetMap) {
      //   return;
      // }
      // const map = gameModel.getTypedUnsafe(Map, targetMap);
      // const mapSystem = gameModel.getSystem(MapSystem);
      // const transform = gameModel.getTypedUnsafe(Transform, entity);
      // const targetPosition = { x: transform.x, y: transform.y };
      // const mapTarget = getMapPosition(map, toMapSpace(targetPosition, true), 20);

      // console.log(mapTarget, map.scale);

      const originalPosition = {
        x: -317.8787841796875,
        y: 345.84014892578125,
      };
      const dropPosition = makePickupable(gameModel, { ...originalPosition });

      const ball = EntityFactory.getInstance().generateEntity(gameModel, "ball", {
        Transform: dropPosition,
      });
      gameModel.addComponent(DrawSpawnBallOnQ, ball, { originalPosition });
    }
  }
}

@Component()
export class DrawSpawnBallOnQ extends Schema {
  @type(Vector2d)
  originalPosition: Vector2d;
}

@System(DrawSpawnBallOnQ)
export class DrawSpawnBallOnQSystem extends DrawSystemImpl<GameModel> {
  ids: Set<number> = new Set();
  debug = true;
  entities: { [entity: number]: { points: PIXI.Graphics[]; line: PIXI.Graphics } } = {};

  init(gameModel: GameModel, entity: number) {
    const viewport = getSystem(gameModel, PixiViewportSystem).viewport;

    this.ids.add(entity);
    this.entities[entity] = {
      points: [],
      line: new PIXI.Graphics(),
    };
    this.entities[entity].line.zIndex = 9999;
    viewport.addChild(this.entities[entity].line);
  }

  run(gameModel: GameModel, entity: number) {
    const viewport = getSystem(gameModel, PixiViewportSystem).viewport;
    const transform = gameModel.getTypedUnsafe(Transform, entity);
    const originalPosition = gameModel.getTypedUnsafe(DrawSpawnBallOnQ, entity).originalPosition;
    const graphics = this.entities[entity].points;
    const line = this.entities[entity].line;

    line.clear();

    graphics.forEach((g) => {
      g.clear();
    });

    const chasePath = [transform, originalPosition];

    for (let i = 0; i < chasePath.length; i += 2) {
      const v = chasePath[i]!;
      if (i === 0) {
        line.lineStyle(5, 0x00ff00);
        line.moveTo(v.x, v.y);
      } else {
        line.lineTo(v.x, v.y);
      }
      if (!graphics[i / 2]) {
        graphics[i / 2] = new PIXI.Graphics();
        graphics[i / 2].zIndex = 10000;
        viewport.addChild(graphics[i / 2]);
      }
      const g = graphics[i / 2];
      g.clear();
      g.beginFill(0xff00ff);
      g.drawCircle(v.x, v.y, 10);
      g.endFill();
    }
  }

  cleanup(gameModel: GameModel, entity: number) {
    this.ids.delete(entity);
    this.entities[entity]?.line.clear();
    this.entities[entity]?.line.destroy();
    this.entities[entity]?.points.forEach((g) => {
      g.clear();
      g.destroy();
    });
    delete this.entities[entity];
  }
}
