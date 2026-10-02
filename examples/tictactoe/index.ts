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
import { QuickStart } from "yage/game/QuickStart";
import { showTictactoeLobby } from "./lobby.js";
import { tictactoeIdentity } from "./systems/TicTacToe.js";

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

const onPlayerLeave = (gameModel: GameModel, playerId: string) => {
  const players = gameModel.getComponentActives("PlayerInput");
  const player = players.find((p) => {
    const pi = gameModel.getTypedUnsafe(PlayerInput, p);
    return pi.pid === playerId;
  });
  if (player) {
    gameModel.removeEntity(player);
  }
};

// Step mode: place-mark events are consumed on their scheduled frame instead
// of being dropped on realtime frame gaps.
async function bootLocal(): Promise<GameInstance<null>> {
  tictactoeIdentity.selfNetId = null;
  const inputManager = new InputManager(false);
  const keyboardListener = new KeyboardListener(inputManager);
  keyboardListener.init();

  // Local hot-seat match: two keyboard players share the page (X and O).
  const players: [InputEventType, number, undefined][] = [
    [InputEventType.KEYBOARD, 0, undefined],
    [InputEventType.KEYBOARD, 0, undefined],
  ];

  const connection = new CoopConnectionInstance(inputManager, players);
  await connection.connect();

  const instance = new GameInstance({
    connection,
    uiService: true,
    buildWorld: () => {},
    onPlayerJoin,
    onPlayerLeave,
    executionMode: "step",
  });

  await instance.initializeRoom("QuickStart", "QuickStart");
  instance.stepManual();
  return instance;
}

async function bootOnline(code: string): Promise<GameInstance<null>> {
  const netId = "captain-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  // This browser's captain identity; the UI system attributes moves with it.
  tictactoeIdentity.selfNetId = netId;
  const peerHost = new URLSearchParams(window.location.search).get("peer") || "peer.yage.games";

  // One PeerMultiplayerInstance serves both roles: the first browser to open
  // a code hosts it, later browsers join the same code.
  const instance = await QuickStart({
    gameName: "Tic Tac Toe",
    roomId: "QuickStart",
    seed: "QuickStart",
    buildWorld: () => {},
    onPlayerJoin,
    onPlayerLeave,
    preload,
    executionMode: "step",
    connection: "PEER",
  }, { netId, uniqueId: netId, token: netId, config: null }, {
    prefix: "tictactoe-",
    host: peerHost,
    address: code,
  });
  return instance;
}

(async () => {
  await preload();

  const params = new URLSearchParams(window.location.search);
  const isE2E = params.get("e2e") === "true";

  if (isE2E) {
    tictactoeIdentity.selfNetId = null;
    const inputManager = new InputManager(false);
    const connection = new E2EConnectionInstance(inputManager);
    await connection.connect();

    const instance = new GameInstance({
      connection,
      uiService: true,
      buildWorld: () => {},
      onPlayerJoin,
      onPlayerLeave,
      executionMode: "step",
    });

    await instance.initializeRoom("QuickStart", "QuickStart");
    instance.stepManual();

    // @ts-ignore
    if (instance.ticker) {
      // @ts-ignore
      instance.ticker.stop();
    }

    const bridge = new E2EBridge(instance, inputManager);
    bridge.ready = true;
    // @ts-ignore
    window.__YAGE_E2E__ = bridge;
    return;
  }

  showTictactoeLobby(choice => {
    if (choice.mode === "local") {
      bootLocal().catch(error => { console.error("Local game failed to start", error); });
      return;
    }
    bootOnline(choice.code ?? "").catch(error => {
      console.error("Online game failed to start", error);
      alert("Could not reach the online room. Check the room code and try again.");
    });
  });
})();
