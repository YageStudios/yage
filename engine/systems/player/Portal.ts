import type { GameModel } from "yage/game/GameModel";
import { Portal } from "yage/schemas/player/Portal";
import { System, SystemImpl } from "minecs";
import { MapId } from "yage/schemas/map/MapSpawn";

@System(Portal)
export class PortalSystem extends SystemImpl<GameModel> {
  static depth = -1;

  run = (gameModel: GameModel, entity: number) => {
    const data = gameModel.getTypedUnsafe(Portal, entity);
    const mapIdData = gameModel.getTypedUnsafe(MapId, entity);

    mapIdData.map = data.map;
    if (data.fromSave) {
      mapIdData.mapId = data.mapId;
    } else {
      mapIdData.mapId = -1;
    }

    const player = gameModel.ejectEntity(entity);

    gameModel.paused = true;

    // FIXME: This doesn't work yet
    // (async () => {
    //   if (data.fromSave) {
    //     await gameModel.loadState(data.fromSave);
    //     if (data.removeSave) {
    //       gameModel.removeSave(data.fromSave);
    //     }
    //   } else {
    //     gameModel.clearState();
    //     gameModel.coreEntity = EntityFactory.getInstance().generateEntity(gameModel, "core");
    //   }
    //   gameModel.paused = false;

    //   const injectedPlayer = gameModel.injectEntity(player);
    //   gameModel.removeComponent(injectedPlayer, "Portal");

    //   gameModel.addComponent(injectedPlayer, MapSpawnSchema, {
    //     map: data.map,
    //     location: data.spawnPoint || "Spawn Point",
    //     spawnX: data.x,
    //     spawnY: data.y,
    //   });
    // })();
  };
}
