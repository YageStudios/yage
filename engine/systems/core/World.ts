import { System, SystemImpl } from "minecs";
import { HALF_WORLD_WIDTH, WORLD_WIDTH } from "yage/constants";
import type { GameModel } from "yage/game/GameModel";
import { World } from "yage/schemas/core/World";
import { Transform } from "yage/schemas/entity/Transform";

@System(World, Transform)
export class WorldSystem extends SystemImpl<GameModel> {
  static depth = -1;

  init = (gameModel: GameModel, entity: number) => {
    const transform = gameModel.getTypedUnsafe(Transform, entity);
    gameModel(Transform, entity).x = this.toWorldSpace(gameModel, entity, transform.x);
  };

  toWorldSpace = (gameModel: GameModel, entity: number, value: number) => {
    const world = gameModel(World).store.world[entity];
    if (value < world * WORLD_WIDTH - HALF_WORLD_WIDTH || value > world * WORLD_WIDTH + HALF_WORLD_WIDTH) {
      if (value > HALF_WORLD_WIDTH) {
        const worldOffset = Math.floor(value + HALF_WORLD_WIDTH / WORLD_WIDTH);
        value -= worldOffset * WORLD_WIDTH;
      }
      value = world * WORLD_WIDTH + value;
    }
    return value;
  };
}
