import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createWorld } from "minecs";
import { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import { CoreConnectionInstance } from "yage/connection/CoreConnectionInstance";
import { HistoryConnectionInstance } from "yage/connection/HistoryConnectionInstance";

const makeModel = () =>
  GameModel({
    seed: "replay-hash",
    roomId: "room",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });

const stepFrames = (gameModel: GameModel, frames: number) => {
  for (let i = 0; i < frames; i++) {
    gameModel.step();
  }
};

// Drives the real recording entry points exactly as a hosted game does:
// firstFrame on boot, maybeHashState on every desync-check interval frame.
class RecordingConnection extends CoreConnectionInstance<any> {
  recordBootHash(gameModel: GameModel) {
    this.firstFrame(gameModel, {});
  }

  recordIntervalHash(gameModel: GameModel) {
    (this as any).maybeHashState(gameModel);
  }
}

const recordLiveHistory = () => {
  const recorder = new RecordingConnection(
    { netId: "player-1", uniqueId: "player-1", token: "t", config: {} },
    new InputManager(),
    { historyPersistence: false }
  );
  recorder.history["room"] = {
    seed: "replay-hash",
    startTimestamp: 0,
    frames: {},
    configs: {},
    stateHashes: {},
    snapshots: {},
  };
  const source = makeModel();
  recorder.recordBootHash(source);
  stepFrames(source, 60);
  recorder.recordIntervalHash(source);
  recorder.history["room"].configs = { "player-1": {} };
  return recorder.history["room"];
};

describe("replay verification", () => {
  let logSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("a live-recorded history replays without a false State mismatch", () => {
    const replay = new HistoryConnectionInstance({ room: recordLiveHistory() });

    const playback = makeModel();
    expect(() => replay.endFrame(playback)).not.toThrow();

    stepFrames(playback, 60);
    expect(() => replay.endFrame(playback)).not.toThrow();
  });

  test("a genuinely divergent replay still fails verification", () => {
    const replay = new HistoryConnectionInstance({ room: recordLiveHistory() });

    const divergent = makeModel();
    stepFrames(divergent, 60);
    divergent.addComponent("Description", divergent.addEntity(), { description: "drift" });

    expect(() => replay.endFrame(divergent)).toThrow(/State mismatch/);
  });
});
