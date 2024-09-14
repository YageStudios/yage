import "yage/schemas/index";
import "yage/console/preload";

import { EntityFactory } from "yage/entity/EntityFactory";
import type { GameModel } from "yage/game/GameModel";
import AssetLoader from "yage/loader/AssetLoader";
import { QuickStart } from "yage/game/QuickStart";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { InputManager } from "yage/inputs/InputManager";

QuickStart(
  {
    gameName: "MapTest",
    roomId: "QuickStart",
    seed: "QuickStart",
    onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: any) => {
      const player = EntityFactory.getInstance().generateEntity(gameModel, "ball");

      gameModel.logEntity(player, true);

      const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
      playerInput.keyMap = InputManager.buildKeyMap();
      playerInput.pid = playerId;
      playerInput.name = playerConfig.name;
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
