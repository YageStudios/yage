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
import { Persist } from "yage/persist/persist";
import { nanoid } from "nanoid";

await Persist.getInstance().init();

const playerId = await Persist.getInstance().setIfMissing("playerId", nanoid());
const lobbyId = "example-socket-lobby";

QuickStart(
  {
    gameName: "Reball",
    roomId: "QuickStart",
    seed: "QuickStart",
    connection: "SOCKET",
    onPlayerJoin: (gameModel: GameModel, playerId: string) => {
      const player = EntityFactory.getInstance().generateEntity(gameModel, "ball");

      gameModel.logEntity(player, true);

      const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
      playerInput.keyMap = InputManager.buildKeyMap();
      playerInput.pid = playerId;
      // PlayerInput.name = playerConfig.name;

      const isoGuy = EntityFactory.getInstance().generateEntity(gameModel, "iso-guy");
      const transform = gameModel.getTypedUnsafe(Transform, isoGuy);
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
  },
  {
    uniqueId: playerId,
    token: "",
    netId: nanoid(),
    config: {},
  },
  {
    address: lobbyId,
    host: "localhost:3001",
  }
);
