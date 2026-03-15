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
import { UIService } from "yage/ui/UIService";
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

  // Set up input manager with separate key maps per input type
  const inputManager = new InputManager(false); // combineKeyMaps = false for coop

  const uiService = UIService.getInstance();

  if (!isE2E) {
    // Initialize keyboard listener with arrow keys and enter
    const keyboardListener = new KeyboardListener(inputManager);
    keyboardListener.init();

    // Tell UIService about the two player inputs so focus navigation works per-player
    uiService.playerInputs = [
      [InputEventType.MOUSE, 0],
      [InputEventType.KEYBOARD, 0],
    ];

    // Map Enter key to trigger click on the focused element for the keyboard player (player 1)
    inputManager.addKeyListener((key, pressed, eventType, _typeIndex, e) => {
      if (key === "enter" && pressed && eventType === InputEventType.KEYBOARD) {
        const keyboardPlayerIndex = uiService.getPlayerEventIndex(InputEventType.KEYBOARD, 0);
        if (keyboardPlayerIndex !== -1) {
          const focused = uiService._focusedElementByPlayerIndex[keyboardPlayerIndex];
          if (focused) {
            focused.onClick(keyboardPlayerIndex);
            e?.preventDefault();
            e?.stopImmediatePropagation();
            return false;
          }
        }
      }
    });
  }

  // Set up coop connection:
  // Player 0 (X): Mouse input
  // Player 1 (O): Keyboard input (arrows + space)
  const players: [InputEventType, number, undefined][] = [
    [InputEventType.MOUSE, 0, undefined],
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
    // @ts-ignore - accessing protected ticker for deterministic stepping
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
