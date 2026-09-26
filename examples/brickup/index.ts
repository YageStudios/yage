import "yage/schemas/index";

import { EntityFactory } from "yage/entity/EntityFactory";
import AssetLoader from "yage/loader/AssetLoader";
import { InputManager } from "yage/inputs/InputManager";
import type { GameModel } from "yage/game/GameModel";
import { KeyboardListener } from "yage/inputs/KeyboardListener";
import { SingleplayerConnectionInstance } from "yage/connection/SingleplayerConnectionInstance";
import { E2EConnectionInstance } from "yage/connection/E2EConnectionInstance";
import { HistoryConnectionInstance } from "yage/connection/HistoryConnectionInstance";
import { GameReplayInstance } from "yage/game/GameReplayInstance";
import { GameInstance } from "yage/game/GameInstance";
import { E2EBridge } from "yage/testing/E2EBridge";
import { SocketIoMultiplayerInstance } from "yage/connection/SocketIoMultiplayerInstance";
import { InputEventType } from "yage/inputs/InputManager";
import { paddleForPid } from "./systems/BrickUpPlayers";
import { PixiViewportSystem } from "yage/systems/render/PixiViewport";
import { CENTER_X, CENTER_Y, enableRapierArena } from "./systems/BrickUpField";
import { onObserverJoin, onPlayerJoin, onPlayerLeave } from "./systems/BrickUpPlayers";

const preload = async () => {
  await import("./systems");
  const entityDefinitions = (await import("./entities")).default;
  EntityFactory.configureEntityFactory(entityDefinitions);
  await AssetLoader.getInstance().loadUi("BrickUpUI", "BrickUpUI.json5");
  await AssetLoader.getInstance().load();
};

// The shared viewport camera is never given a focus; point it at the arena
// so the field is centered and fully framed at any window size.
const focusArenaCamera = (connection: { roomStates: { [roomId: string]: { gameModel?: GameModel } } }) => {
  const gameModel = connection.roomStates["QuickStart"]?.gameModel;
  if (!gameModel) {
    return;
  }
  const viewport = gameModel.getSystem(PixiViewportSystem).viewport;
  viewport?.moveCenter(CENTER_X, CENTER_Y);
  const pixiApp = (window as any).__PIXI_APP__;
  if (pixiApp) {
    pixiApp.renderer.background.color = 0x0b0e14;
  }
};

const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
const flag = (name: string) => {
  const value = params.get(name);
  return value === "" || value === "true";
};

const viewLabel = (text: string) => {
  const label = document.createElement("div");
  label.textContent = text;
  label.style.cssText =
    "position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:10;color:#dfe6f3;font:16px monospace;background:rgba(0,0,0,0.55);padding:4px 12px;border-radius:6px;pointer-events:none";
  document.body.appendChild(label);
};

// Replay transport controls: play/pause, scrub slider, speed, frame counter.
const mountReplayControls = (replay: GameReplayInstance<null>) => {
  const bar = document.createElement("div");
  bar.style.cssText =
    "position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:10;display:flex;gap:10px;align-items:center;background:rgba(10,14,22,0.85);border:1px solid #26324a;border-radius:8px;padding:8px 14px;font:13px monospace;color:#dfe6f3";

  const playButton = document.createElement("button");
  playButton.textContent = "▶";
  playButton.style.cssText = "background:#26324a;color:#dfe6f3;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:14px";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = "0";
  slider.max = String(replay.totalFrames);
  slider.value = "0";
  slider.style.cssText = "width:340px;accent-color:#2fa6ff";

  const frameLabel = document.createElement("span");
  frameLabel.style.cssText = "min-width:130px;text-align:center";

  const speedGroup = document.createElement("div");
  speedGroup.style.cssText = "display:flex;gap:4px";
  for (const speed of [0.5, 1, 2, 4]) {
    const button = document.createElement("button");
    button.textContent = `${speed}×`;
    button.dataset.speed = String(speed);
    button.style.cssText = "background:#141b26;color:#8a94a8;border:1px solid #26324a;border-radius:4px;padding:3px 7px;cursor:pointer";
    button.onclick = () => {
      replay.onPlaybackSpeedChange(speed);
      speedGroup.querySelectorAll("button").forEach((b) => ((b as HTMLElement).style.color = "#8a94a8"));
      button.style.color = "#2fa6ff";
    };
    if (speed === 1) {
      button.style.color = "#2fa6ff";
    }
    speedGroup.appendChild(button);
  }

  const syncPlayButton = () => {
    playButton.textContent = replay.playing ? "⏸" : "▶";
  };
  playButton.onclick = () => {
    if (replay.playing) {
      replay.pausePlayback();
    } else {
      replay.resumePlayback();
    }
    syncPlayButton();
  };
  slider.oninput = () => replay.onScrub(Number(slider.value));
  syncPlayButton();

  bar.appendChild(playButton);
  bar.appendChild(slider);
  bar.appendChild(frameLabel);
  bar.appendChild(speedGroup);
  document.body.appendChild(bar);

  setInterval(() => {
    const frame = Math.min(replay.currentFrame, replay.totalFrames);
    if (document.activeElement !== slider) {
      slider.value = String(frame);
    }
    frameLabel.textContent = `frame ${frame} / ${replay.totalFrames}`;
    if (frame >= replay.totalFrames && replay.playing) {
      replay.pausePlayback();
      syncPlayButton();
    }
  }, 100);
};

(async () => {
  await preload();

  const isE2E = flag("e2e");
  const observer = flag("observer");
  const replay = flag("replay");
  const socketMode = flag("socket");
  const arenaPlayerId = params.get("player") ?? "player1";
  const arenaRoom = params.get("room") ?? "arena";

  // ?physics=rapier runs the same game on the Rapier solver instead of the
  // manual integrator; the mode is part of the serialized board state.
  const physicsMode = params.get("physics") === "rapier" ? "rapier" : "manual";

  const inputManager = new InputManager(true);

  if (!isE2E && !replay) {
    const keyboardListener = new KeyboardListener(inputManager);
    keyboardListener.init();
  }

  const buildWorldForDemo = (gameModel: GameModel) => {
    if (physicsMode === "rapier") {
      enableRapierArena(gameModel);
    }
  };

  let replayInstance: GameReplayInstance<null> | null = null;
  let connection;
  if (socketMode) {
    const playerId = params.get("player") ?? "player1";
    const roomName = params.get("room") ?? "arena";
    const socketHost = params.get("server") ?? "http://localhost:3001";
    // Stagger boots by player index: the first player hosts, the rest must
    // see the populated room or they race each other into parallel hosts.
    const playerIndex = Number(arenaPlayerId.replace(/^player/, "")) || 1;
    await new Promise((resolve) => setTimeout(resolve, (playerIndex - 1) * 3000));
    connection = new SocketIoMultiplayerInstance(
      { netId: playerId, uniqueId: playerId, token: playerId, config: null },
      inputManager,
      { address: roomName, host: socketHost },
    );
    await connection.connect();
    // Debug surface for the arena harness: inspect the wire state per peer.
    (window as any).__BRICKUP_CONNECTION__ = connection;
    (window as any).__BRICKUP_ROOM__ = roomName;
  } else if (replay) {
    const historyConnection = new HistoryConnectionInstance();
    try {
      await historyConnection.connect();
    } catch {
      // connect() throws when nothing has been recorded yet.
    }
    if (historyConnection.replayHistory) {
      replayInstance = new GameReplayInstance(historyConnection.history, {
        uiService: true,
        buildWorld: buildWorldForDemo,
        onPlayerJoin,
        onPlayerLeave,
      });
      await replayInstance.ready;
      connection = replayInstance.options.connection;
    } else {
      // Nothing recorded yet — fall back to a live game instead of a blank
      // replay.
      connection = new SingleplayerConnectionInstance(inputManager);
      await connection.connect();
    }
  } else if (isE2E) {
    connection = new E2EConnectionInstance(inputManager);
    await connection.connect();
  } else {
    connection = new SingleplayerConnectionInstance(inputManager);
    await connection.connect();
  }

  let instance: GameInstance<null> | null = null;
  if (!replayInstance) {
    instance = new GameInstance({
      connection,
      uiService: true,
      buildWorld: (gameModel: GameModel) => {
        if (physicsMode === "rapier") {
          enableRapierArena(gameModel);
        }
      },
      onPlayerJoin: observer || socketMode ? onObserverJoin : onPlayerJoin,
      onPlayerLeave,
    });

    await instance.initializeRoom(socketMode ? arenaRoom : "QuickStart", "brickup");
    focusArenaCamera(connection);
    // The arena coordinator waits on this before booting the next player.
    if (socketMode) {
      (window as any).__BRICKUP_ROOM_JOINED__ = true;
    }

    if (socketMode) {
      // Click the arena to claim a side from the AI. The claim rides the
      // lockstep input frames, so every peer sees the same takeover.
      document.getElementById("interaction")?.addEventListener("click", () => {
        inputManager.dispatchEvent("claim", true, InputEventType.KEYBOARD, 0);
        setTimeout(() => inputManager.dispatchEvent("claim", false, InputEventType.KEYBOARD, 0), 80);
      });

      const prompt = document.createElement("div");
      prompt.textContent = "CLICK TO TAKE OVER A SIDE";
      prompt.style.cssText =
        "position:fixed;bottom:60px;left:50%;transform:translateX(-50%);z-index:10;color:#dfe6f3;font:14px monospace;background:rgba(0,0,0,0.6);padding:6px 14px;border-radius:6px;pointer-events:none";
      document.body.appendChild(prompt);
      setInterval(() => {
        const gameModel = (connection as { roomStates: { [roomId: string]: { gameModel?: GameModel } } })
          .roomStates[arenaRoom]?.gameModel;
        const claimed = gameModel ? paddleForPid(gameModel, arenaPlayerId) !== undefined : false;
        prompt.style.display = claimed ? "none" : "block";
      }, 300);
    }
  }

  if (replayInstance) {
    focusArenaCamera(connection as any);
    mountReplayControls(replayInstance);
    viewLabel("REPLAY — last recorded game");
  }
  if (observer) {
    viewLabel("OBSERVER — four AI players");
  }

  if (isE2E) {
    if (!instance) {
      throw new Error("E2E mode requires a live game instance");
    }
    instance.ticker.stop();

    const bridge = new E2EBridge(instance, inputManager);
    bridge.ready = true;
    // @ts-ignore
    window.__YAGE_E2E__ = bridge;
  }
})();
