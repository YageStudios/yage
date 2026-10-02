import { beforeAll, describe, expect, test, vi } from "vitest";
import { createWorld } from "minecs";
import { cloneDeep } from "lodash";
import { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { hashWorldState } from "yage/game/StateHash";
import { GameReplayInstance } from "yage/game/GameReplayInstance";
import type { ReplayStack } from "yage/connection/ConnectionInstance";
import { initRapier, setupRealPhysicsGlobals } from "../helpers/realPhysics";

beforeAll(async () => {
  setupRealPhysicsGlobals();
  // The Ticker is a fixed-step accumulator over the rAF timestamp; the test
  // setup shim passes 0, so give it real elapsed time.
  vi.stubGlobal("requestAnimationFrame", (cb: (time: number) => void) =>
    setTimeout(() => cb(performance.now()), 0)
  );
  await initRapier();
  await import("yage/schemas/index");
  // Component/system registration must happen before any world exists.
  await import("../../examples/brickup/systems");
});

const SEED = "replay-instance-proof";
const RUN_FRAMES = 200;
const PID = "p1";

// The brickup game is a dense, gameplay-rich sim; replaying it end-to-end
// is the strongest replay proof available. Systems register in beforeAll.
const buildWorld = () => {};

const onPlayerJoin = (gameModel: GameModel, playerId: string) => {
  const player = gameModel.addEntity();
  gameModel.addComponent("PlayerInput", player);
  const input = gameModel.getTypedUnsafe(PlayerInput, player);
  input.keyMap = new Map();
  input.prevKeyMap = new Map();
  input.events = [];
  input.pid = playerId;
  return player;
};

// A live model stepped with a scripted input, recorded the same way the
// connection layer records: snapshot at frame 0, frames per player, and
// interval state hashes.
const makeRecording = () => {
  // Built exactly like the replay boot builds its world (factory default
  // capacity), so serialized bytes — and therefore hashes — line up.
  const model = GameModel({
    seed: SEED,
    roomId: "replay-room",
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });
  void createWorld;
  const player = onPlayerJoin(model, PID);

  const snapshots: { [frame: number]: ReturnType<GameModel["serializeState"]> } = {};
  const stateHashes: { [frame: number]: string } = {};
  const frames: ReplayStack<never>["frames"] = { [PID]: [] };

  snapshots[0] = cloneDeep(model.serializeState());
  // Mirror consumePlayerFrame exactly: entry F is recorded at index F, then
  // the model steps, so the recorded array is dense and position === frame.
  for (let frame = 0; frame < RUN_FRAMES; frame++) {
    const input = model.getTypedUnsafe(PlayerInput, player);
    input.prevKeyMap = input.keyMap;
    const keys = new Map<string, boolean>();
    keys.set("right", frame % 90 < 45);
    keys.set("left", frame % 90 >= 45);
    input.keyMap = keys;

    frames[PID][frame] = {
      frame,
      keys: { right: frame % 90 < 45, left: frame % 90 >= 45 },
      events: [],
      playerId: PID,
    } as never;

    model.step();

    // Hash every frame: endFrame then pins the FIRST divergent frame.
    stateHashes[model.frame] = hashWorldState(model);
  }
  // Playback clamps to the last recorded entry, so the final comparable
  // world frame is the one after the last consumed input.
  const finalHash = hashWorldState(model);

  const stack: { [roomId: string]: ReplayStack<never> } = {
    "replay-room": {
      seed: SEED,
      startTimestamp: 0,
      frames,
      configs: { [PID]: {} },
      stateHashes,
      snapshots,
    } as never,
  };
  return { stack, original: model, finalHash, stateHashes };
};

const waitForFrame = async (instance: GameReplayInstance<never>, target: number, timeoutMs = 45000) => {
  const gameModel = (instance as any).options.connection.roomStates["replay-room"].gameModel as GameModel;
  const started = Date.now();
  while (gameModel.frame < target) {
    if (Date.now() - started > timeoutMs) {
      throw new Error(`replay stalled at frame ${gameModel.frame}, wanted ${target}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return gameModel;
};

describe("GameReplayInstance", () => {
  test("replays a recorded game to completion and lands on the original state", { timeout: 30000 }, async () => {
    const { stack, stateHashes } = makeRecording();
    const instance = new GameReplayInstance(stack, {
      uiService: false,
      buildWorld: buildWorld as any,
      onPlayerJoin,
      onPlayerLeave: () => {},
    });

    await instance.ready;

    const conn: any = (instance as any).options.connection;
    const replayModel = conn.roomStates["replay-room"].gameModel;
    console.log(
      `[divergence] bootHash=${hashWorldState(replayModel)} bootEntities=${JSON.stringify([...replayModel.entitySparseSet.dense])} frame=${replayModel.frame} elapsed=${replayModel.timeElapsed}`,
    );
    // A freshly booted model through the same path is what the recording's
    // frame 0 must equal; compare against the recording's snapshot directly.
    const snapshot = conn.replayHistory.snapshots[0];
    const snapshotWorld = JSON.stringify(snapshot.world);
    const bootWorld = JSON.stringify(replayModel.serializeState().world);
    console.log(`[divergence] snapshotWorldBytes=${snapshotWorld.length} bootWorldBytes=${bootWorld.length} equal=${snapshotWorld === bootWorld}`);
    if (snapshotWorld !== bootWorld) {
      for (let i = 0; i < Math.min(snapshotWorld.length, bootWorld.length); i++) {
        if (snapshotWorld[i] !== bootWorld[i]) {
          console.log(`[divergence] first diff at ${i}: snapshot=...${snapshotWorld.slice(Math.max(0, i - 60), i + 60)} boot=...${bootWorld.slice(Math.max(0, i - 60), i + 60)}`);
          break;
        }
      }
    }

    instance.resumePlayback();
    const replayed = await waitForFrame(instance, RUN_FRAMES - 1);

    // The replayed world must match the original run bit-for-bit at the end
    // of the recording — endFrame verified every recorded hash along the way.
    expect(hashWorldState(replayed)).toBe(stateHashes[RUN_FRAMES - 1]);
    instance.pausePlayback();
  });

  test("resumePlayback continues from the current position instead of freezing", { timeout: 30000 }, async () => {
    const { stack } = makeRecording();
    const instance = new GameReplayInstance(stack, {
      uiService: false,
      buildWorld: buildWorld as any,
      onPlayerJoin,
      onPlayerLeave: () => {},
    });
    await instance.ready;

    instance.resumePlayback();
    await waitForFrame(instance, 30);
    instance.pausePlayback();
    const pausedAt = (instance as any).options.connection.roomStates["replay-room"].gameModel.frame;

    // Pause + resume must keep the tape rolling from where it stopped, not
    // rewind to the start.
    instance.resumePlayback();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const resumedModel = (instance as any).options.connection.roomStates["replay-room"].gameModel;
    expect(resumedModel.frame).toBeGreaterThanOrEqual(pausedAt);
    await waitForFrame(instance, 90);
    instance.pausePlayback();
  });

  test("scrubbing backwards rewinds and re-simulates forward", { timeout: 30000 }, async () => {
    const { stack, stateHashes } = makeRecording();
    const instance = new GameReplayInstance(stack, {
      uiService: false,
      buildWorld: buildWorld as any,
      onPlayerJoin,
      onPlayerLeave: () => {},
    });
    await instance.ready;

    instance.resumePlayback();
    await waitForFrame(instance, 130);
    instance.pausePlayback();

    const gameModel = (instance as any).options.connection.roomStates["replay-room"].gameModel as GameModel;
    const frameBeforeScrub = gameModel.frame;
    instance.onScrub(20);
    const rewindDeadline = Date.now() + 5000;
    while (gameModel.frame >= frameBeforeScrub && Date.now() < rewindDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(gameModel.frame).toBeLessThan(frameBeforeScrub);
    expect(gameModel.frame).toBeLessThanOrEqual(20);
    expect(instance.currentFrame).toBe(20);

    instance.resumePlayback();
    await waitForFrame(instance, 140);
    instance.pausePlayback();

    const replayed = (instance as any).options.connection.roomStates["replay-room"].gameModel as GameModel;
    expect(replayed.frame).toBeGreaterThanOrEqual(140);
    expect(stateHashes[replayed.frame]).toBeDefined();
    expect(hashWorldState(replayed)).toBe(stateHashes[replayed.frame]);
  });
});
