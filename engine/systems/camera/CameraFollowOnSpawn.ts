import { SystemImpl, System } from "minecs";
import { ComponentCategory } from "yage/constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { CameraFollowOnSpawn } from "yage/schemas/camera/CameraFollowOnSpawn";
import { EntityCamera } from "yage/schemas/camera/EntityCamera";

@System(CameraFollowOnSpawn)
export class CameraFollowOnSpawnSystem extends SystemImpl<GameModel> {
  init = (gameModel: GameModel, entity: number) => {
    gameModel.getTypedUnsafe(EntityCamera, gameModel.coreEntity).entity = entity;
  };
}
