import "yage/schemas/index";
import "yage/console/preload";

import { EntityFactory } from "yage/entity/EntityFactory";
import AssetLoader from "yage/loader/AssetLoader";
import { InputManager, InputEventType } from "yage/inputs/InputManager";
import type { GameModel } from "yage/game/GameModel";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { KeyboardListener } from "yage/inputs/KeyboardListener";
import { CoopConnectionInstance } from "yage/connection/CoopConnectionInstance";
import { E2EConnectionInstance } from "yage/connection/E2EConnectionInstance";
import { GameInstance } from "yage/game/GameInstance";
import { E2EBridge } from "yage/testing/E2EBridge";

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
  await preload();

  const isE2E = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("e2e") === "true";

  const inputManager = new InputManager(false);

  if (!isE2E) {
    const keyboardListener = new KeyboardListener(inputManager);
    keyboardListener.init();
  }

  // Player 0: WASD (left paddle), Player 1: Arrow keys (right paddle)
  const players: [InputEventType, number, undefined][] = [
    [InputEventType.KEYBOARD, 0, undefined],
    [InputEventType.KEYBOARD, 0, undefined],
  ];

  const connection = isE2E
    ? new E2EConnectionInstance(inputManager)
    : new CoopConnectionInstance(inputManager, players);
  await connection.connect();

  const instance = new GameInstance({
    connection,
    uiService: true,
    buildWorld: () => {},
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
  });

  instance.initializeRoom("QuickStart", "QuickStart");

  if (isE2E) {
    // @ts-ignore
    if (instance.ticker) {
      // @ts-ignore
      instance.ticker.stop();
    }

    const bridge = new E2EBridge(instance, inputManager);
    bridge.ready = true;
    // @ts-ignore
    window.__YAGE_E2E__ = bridge;
  }
})();