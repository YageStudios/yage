import "yage/schemas/index";
import "yage/console/preload";
import "./flags";

import { EntityFactory } from "yage/entity/EntityFactory";
import AssetLoader from "yage/loader/AssetLoader";
import { InputManager } from "yage/inputs/InputManager";
import type { GameModel } from "yage/game/GameModel";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { QuickStart } from "yage/game/QuickStart";
import { flags } from "yage/console/flags";
import { Transform } from "yage/schemas/entity/Transform";
import { GameReplayInstance } from "yage/game/GameReplayInstance";
import { createControls } from "./replay";

const playerJoin = (gameModel: GameModel, playerId: string, playerConfig: any) => {
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
};

const preload = async () => {
  await import("./systems");
  const entityDefinitions = (await import("./entities")).default;
  EntityFactory.configureEntityFactory(entityDefinitions);

  await AssetLoader.getInstance().load();
};

if (flags.HISTORY_RERUN) {
  (async () => {
    await preload();

    const replayStack = JSON.parse(localStorage.getItem("history") ?? "{}") as any;
    console.log(replayStack);
    const replayInstance = new GameReplayInstance(replayStack, {
      onPlayerJoin: playerJoin,
      buildWorld: () => {},
      onPlayerLeave: () => {},
      uiService: true,
    });
    createControls(replayInstance);
  })();
} else {
  if (flags.HISTORY_RERUN) {
    QuickStart({
      gameName: "Reball",
      roomId: "QuickStart",
      seed: "QuickStart",
      connection: "REPLAY",
      onPlayerJoin: playerJoin,
      preload: preload,
    });
  } else {
    QuickStart({
      gameName: "Reball",
      roomId: "QuickStart",
      seed: "QuickStart",
      connection: "SINGLEPLAYER",
      onPlayerJoin: playerJoin,
      preload: preload,
    });
  }
}
