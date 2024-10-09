import { DrawSystemImpl, System, getSystem } from "minecs";
import type { GameModel } from "yage/game/GameModel";
import { EntityCamera } from "yage/schemas/camera/EntityCamera";
import { Transform } from "yage/schemas/entity/Transform";
import { PixiViewportSystem } from "../render/PixiViewport";
import { DEPTHS } from "yage/constants/enums";

@System(EntityCamera)
export class EntityCameraSystem extends DrawSystemImpl<GameModel> {
  static depth = DEPTHS.PREDRAW;

  run = (world: GameModel, entity: number) => {
    const viewport = getSystem(world, PixiViewportSystem).viewport;

    const data = world.getTypedUnsafe(EntityCamera, entity);
    if (data.entity > -1) {
      const position = world.getTypedUnsafe(Transform, data.entity);
      viewport.moveCenter(position.x, position.y);
    }
  };
}
