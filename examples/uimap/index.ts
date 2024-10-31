import "yage/schemas/index";
import "yage/console/preload";

import { EntityFactory } from "yage/entity/EntityFactory";
import AssetLoader from "yage/loader/AssetLoader";
import { InputManager } from "yage/inputs/InputManager";
import type { GameModel } from "yage/game/GameModel";
import { QuickStart } from "yage/game/QuickStart";
import { flags } from "yage/console/flags";
import { PlayerInput } from "yage/schemas/core/PlayerInput";

QuickStart({
  gameName: "UI Test",
  roomId: "QuickStart",
  seed: "QuickStart",
  connection: "SINGLEPLAYER",
  onPlayerJoin: (gameModel: GameModel, playerId: string) => {
    const player = EntityFactory.getInstance().generateEntity(gameModel, "Player");

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
});
