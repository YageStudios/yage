import "yage/schemas/index";
import "yage/console/preload";

import { EntityFactory } from "yage/entity/EntityFactory";
import type { GameModel } from "yage/game/GameModel";
import AssetLoader from "yage/loader/AssetLoader";
import { QuickStart } from "yage/game/QuickStart";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { InputManager } from "yage/inputs/InputManager";
import { MapSpawn } from "yage/schemas/map/MapSpawn";

(async () => {
  // @ts-ignore
  window.gameInstance = await QuickStart(
    {
      gameName: "MapTest",
      roomId: "QuickStart",
      seed: "QuickStart",
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: any) => {
        console.log("PLAYER JOINING", playerConfig);
        let player: number;
        if (playerConfig?.ejectedPlayer) {
          player = gameModel.injectEntity(playerConfig.ejectedPlayer);
          gameModel.addComponent(MapSpawn, player, {
            map: playerConfig.map,
            unmountPreviousMap: false,
            location: "Spawn Point",
          });
        } else {
          player = EntityFactory.getInstance().generateEntity(gameModel, "Player");
        }

        gameModel.logEntity(player, true);

        const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
        playerInput.keyMap = InputManager.buildKeyMap();
        playerInput.pid = playerId;
        return player;
      },
      preload: async () => {
        await import("./systems");
        const entityDefinitions = (await import("./entities")).default;
        EntityFactory.configureEntityFactory(entityDefinitions);

        await AssetLoader.getInstance().load();
      },
    },
    {}
  );
})();
