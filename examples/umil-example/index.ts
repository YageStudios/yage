import "yage/schemas/index";
import "yage/console/preload";

import { EntityFactory } from "yage/entity/EntityFactory";
import AssetLoader from "yage/loader/AssetLoader";
import type { GameModel } from "yage/game/GameModel";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { InputManager } from "yage/inputs/InputManager";
import { UmilQuickStart } from "yage/umil/UmilQuickStart";

const preload = async () => {
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
  // Use UmilQuickStart instead of QuickStart
  // This will show the UMIL flow: Input Detection -> Main Menu -> Game
  const instance = await UmilQuickStart<null>({
    gameName: "UMIL Example Game",
    gameVersion: "1",

    // UMIL configuration
    umilConfig: {
      // App name shown on title screen
      appName: "UMIL Example Game",

      // Max local players for couch co-op
      maxLocalPlayers: 4,

      // Max online players
      maxOnlinePlayers: 4,

      // Allow local singleplayer/coop games
      allowLocalOnly: true,

      // Allow online multiplayer
      allowOnline: true,

      // Shared surface multiplayer: allow 2 players to share a mouse or touch screen
      maxSharedMousePlayers: 2,
      maxSharedTouchPlayers: 2,

      // Optional: Signaling server URL for online play
      // signalingServerUrl: "wss://your-signaling-server.com",
    },

    // Standard game configuration
    buildWorld: () => {
      // Build your game world here
      console.log("Building world...");
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

    // Optional: Socket.IO configuration for online play
    // socketOptions: {
    //   host: "wss://your-server.com",
    //   address: "lobby",
    // },
  });

  console.log("Game instance created:", instance);
})();
