import "yage/schemas/index";
import "yage/console/preload";
import "./flags";

import { EntityFactory } from "yage/entity/EntityFactory";
import AssetLoader from "yage/loader/AssetLoader";
import { InputManager } from "yage/inputs/InputManager";
import type { GameModel } from "yage/game/GameModel";
import { QuickStart } from "yage/game/QuickStart";
import { flags } from "yage/console/flags";
import { Transform } from "yage/schemas/entity/Transform";
import { PlayerInput } from "yage/schemas/core/PlayerInput";

QuickStart({
  gameName: "Reball",
  roomId: "QuickStart",
  seed: "QuickStart",
  connection: "SINGLEPLAYER",
  onPlayerJoin: (gameModel: GameModel, playerId: string) => {
    const player = EntityFactory.getInstance().generateEntity(gameModel, "ball");

    gameModel.logEntity(player, true);

    const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
    playerInput.keyMap = InputManager.buildKeyMap();
    playerInput.pid = playerId;
    // PlayerInput.name = playerConfig.name;

    const blueBall = EntityFactory.getInstance().generateEntity(gameModel, "blue-ball");
    const transform = gameModel.getTypedUnsafe(Transform, blueBall);
    transform.x = 300;
    transform.y = 300;

    return player;
  },
  preload: async () => {
    await import("./systems");
    const entityDefinitions = (await import("./entities")).default;
    EntityFactory.configureEntityFactory(entityDefinitions);

    await AssetLoader.getInstance().load();
  },
});
