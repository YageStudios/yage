import { registerSystem } from "@/components/ComponentRegistry";
import type { System } from "@/components/System";
import { ComponentCategory } from "@/constants/enums";
import type { GameModel } from "@/game/GameModel";
import { CameraFollowOnSpawnSchema } from "@/schemas/camera/CameraFollowOnSpawn";
import { EntityCameraSchema } from "./EntityCamera";

export class CameraFollowOnSpawnSystem implements System {
  type = "CameraFollowOnSpawn";
  category: ComponentCategory = ComponentCategory.CORE;
  schema = CameraFollowOnSpawnSchema;

  init(entity: number, gameModel: GameModel) {
    gameModel.getTyped(gameModel.coreEntity, EntityCameraSchema).entity = entity;
  }
}
registerSystem(CameraFollowOnSpawnSystem);
