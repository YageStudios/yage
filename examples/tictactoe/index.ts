import "yage/schemas/index";
import "yage/console/preload";

import { EntityFactory } from "yage/entity/EntityFactory";
import AssetLoader from "yage/loader/AssetLoader";
import { InputManager } from "yage/inputs/InputManager";
import type { GameModel } from "yage/game/GameModel";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { UmilQuickStart } from "yage/umil/UmilQuickStart";

const preload = async () => {
  await import("./systems");
  const entityDefinitions = (await import("./entities")).default;
  EntityFactory.configureEntityFactory(entityDefinitions);
  await AssetLoader.getInstance().load();
};

const onPlayerJoin = (gameModel: GameModel, playerId: string) => {
  const player = EntityFactory.getInstance().generateEntity(gameModel, "Player");

  gameModel.logEntity(player, true);

  const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
  playerInput.keyMap = InputManager.buildKeyMap();
  playerInput.pid = playerId;

  return player;
};

(async () => {
  // Use UmilQuickStart for automatic input detection and lobby flow
  // Supports: Local Singleplayer, Local Co-op (WASD vs Arrows), Online Host/Join
  await UmilQuickStart<null>({
    gameName: "Tic Tac Toe",
    gameVersion: "1",

    umilConfig: {
      appName: "Tic Tac Toe",
      maxLocalPlayers: 2,
      maxOnlinePlayers: 2,
      allowLocalOnly: true,
      allowOnline: true,
      maxSharedMousePlayers: 2,
      maxSharedTouchPlayers: 2,
    },

    buildWorld: () => {
      // Tic Tac Toe grid is already rendered via systems
      console.log("Tic Tac Toe world ready");
    },

    onPlayerJoin,

    onPlayerLeave: (gameModel: GameModel, playerId: string) => {
      const players = gameModel.getComponentActives("PlayerInput");
      const player = players.find((p) => {
        const pi = gameModel.getTypedUnsafe(PlayerInput, p);
        return pi.pid === playerId;
      });
      if (player) {
        gameModel.removeEntity(player);
      }
    },

    preload,

    peerOptions: {
      prefix: "yage-",
      host: "peer.yage.games",
    },
  });
})();
