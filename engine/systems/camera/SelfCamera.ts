import { DrawSystemImpl, System, getSystem } from "minecs";
import type { GameModel } from "yage/game/GameModel";
import { Transform } from "yage/schemas/entity/Transform";
import { PixiViewportSystem } from "../render/PixiViewport";
import { SelfCamera } from "yage/schemas/camera/SelfCamera";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { DEPTHS } from "yage/constants/enums";

@System(SelfCamera)
export class SelfCameraSystem extends DrawSystemImpl<GameModel> {
  static depth = DEPTHS.PREDRAW;

  run = (world: GameModel, entity: number) => {
    const viewport = getSystem(world, PixiViewportSystem).viewport;

    const data = world.getTypedUnsafe(SelfCamera, entity);
    const selfId = world.getTypedUnsafe(PlayerInput, entity).pid;
    if (selfId === world.localNetIds[0]) {
      const transform = world.getTypedUnsafe(Transform, entity);
      const position = transform;
      viewport.moveCenter(position.x, position.y);
      viewport.setZoom(data.zoom);
    }
  };
}
