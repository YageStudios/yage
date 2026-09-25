import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWorld } from "minecs";
import { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import { hashWorldState } from "yage/game/StateHash";
import { CoreConnectionInstance, frameOffsetForRtt } from "../../engine/connection/CoreConnectionInstance";
import type { Frame } from "../../engine/connection/ConnectionInstance";

// Wire-level tests flag their mocked game models to opt into a deterministic
// stub hash; real worlds still hash through the actual implementation.
vi.mock("yage/game/StateHash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("yage/game/StateHash")>();
  return {
    hashWorldState: (world: any) =>
      world?.useStubHash
        ? `${world.divergent ? "divergent-" : ""}stub-${world.roomId}-${world.frame}`
        : actual.hashWorldState(world),
  };
});

const buildRealModel = () =>
  GameModel({
    seed: "desync",
    roomId: "desync-room",
    world: createWorld(100),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });

describe("hashWorldState", () => {
  it("produces identical hashes for identically-stepped worlds", () => {
    const a = buildRealModel();
    const b = buildRealModel();

    expect(hashWorldState(a)).toBe(hashWorldState(b));

    a.step();
    b.step();
    expect(hashWorldState(a)).toBe(hashWorldState(b));
  });

  it("changes when the world state changes", () => {
    const a = buildRealModel();
    const b = buildRealModel();

    const entity = a.addEntity();
    a.addComponent("Description", entity, { description: "divergent" });

    expect(hashWorldState(a)).not.toBe(hashWorldState(b));
  });
});

class TestConnection<T> extends CoreConnectionInstance<T> {
  testMaybeHashState(gameModel: any) {
    return (this as any).maybeHashState(gameModel);
  }

  testSubscribeFrame(roomId: string) {
    this.subscribeFrame(roomId);
  }

  /** Simulates a pong for a ping sent `rttMs` ago, as a remote peer would. */
  receivePong(rttMs: number) {
    const nonce = "nonce-1";
    (this as any).pingSentAt.set(nonce, Date.now() - rttMs);
    this.subscriptions["yagePong"]?.forEach((cb) => cb("player-2", nonce));
  }
}

const buildConnection = () => {
  const inputManager = {
    buildKeyMap: () => ({}),
    getKeyMap: () => ({}),
    keyMapToJsonObject: () => ({}),
    toKeyMap: (keys: any) => keys,
  } as unknown as InputManager;
  const player = { netId: "player-1", uniqueId: "player-1", token: "t", config: {} };
  const instance = new TestConnection<any>(player as any, inputManager, {});
  const gameModel = {
    roomId: "room",
    frame: 60,
    executionMode: "realtime",
    ping: 0,
    useStubHash: true,
    serializeState: vi.fn(() => ({ frame: 60 })),
  };
  instance.roomStates["room"] = { gameModel: gameModel as any, frameStack: {}, lastFrame: {} };
  instance.history["room"] = {
    frames: {},
    seed: "s",
    startTimestamp: 0,
    configs: {},
    stateHashes: {},
    snapshots: {},
  };
  return { instance, gameModel };
};

describe("live desync detection", () => {
  let errorSpy: any;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("attaches the state hash to published frames on interval frames and records it in history", () => {
    const { instance, gameModel } = buildConnection();
    const emitSpy = vi.spyOn(instance, "emit").mockImplementation(() => {});

    instance.publishState(instance.roomStates["room"], "player-1", gameModel as any);

    const frame: Frame = emitSpy.mock.calls.filter((call) => call[0] === "frame").pop()![1];
    expect(frame.stateFrame).toBe(60);
    expect(frame.stateHash).toBe("stub-room-60");
    expect(instance.history["room"].stateHashes[60]).toBe("stub-room-60");
  });

  it("does not attach hashes to non-interval frames", () => {
    const { instance, gameModel } = buildConnection();
    (gameModel as any).frame = 61;
    const emitSpy = vi.spyOn(instance, "emit").mockImplementation(() => {});

    instance.publishState(instance.roomStates["room"], "player-1", gameModel as any);

    const frame: Frame = emitSpy.mock.calls.filter((call) => call[0] === "frame").pop()![1];
    expect(frame.stateHash).toBeUndefined();
  });

  it("reports a desync when a remote hash differs from the local hash for the same frame", () => {
    const { instance, gameModel } = buildConnection();
    instance.testSubscribeFrame("room");

    instance.testMaybeHashState(gameModel); // local hash for frame 60 recorded

    instance.subscriptions["frame"]?.forEach((cb) =>
      cb("player-2", {
        frame: 68,
        keys: {},
        events: [],
        playerId: "player-2",
        stateFrame: 60,
        stateHash: "different",
      })
    );

    expect(errorSpy).toHaveBeenCalled();
    expect(errorSpy.mock.calls.some((call: any[]) => String(call[0]).includes("desync"))).toBe(true);
  });

  it("stashes remote hashes that arrive before the local frame and compares them later", () => {
    const { instance, gameModel } = buildConnection();
    instance.testSubscribeFrame("room");

    instance.subscriptions["frame"]?.forEach((cb) =>
      cb("player-2", {
        frame: 68,
        keys: {},
        events: [],
        playerId: "player-2",
        stateFrame: 60,
        stateHash: "different",
      })
    );
    expect(errorSpy).not.toHaveBeenCalled();

    instance.testMaybeHashState(gameModel);

    expect(errorSpy).toHaveBeenCalled();
  });

  it("does not report anything when the hashes match", () => {
    const { instance, gameModel } = buildConnection();
    instance.testSubscribeFrame("room");

    instance.testMaybeHashState(gameModel);

    instance.subscriptions["frame"]?.forEach((cb) =>
      cb("player-2", {
        frame: 68,
        keys: {},
        events: [],
        playerId: "player-2",
        stateFrame: 60,
        stateHash: "stub-room-60",
      })
    );

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ignores its own echoed frames", () => {
    const { instance, gameModel } = buildConnection();
    instance.testSubscribeFrame("room");

    instance.testMaybeHashState(gameModel);

    instance.subscriptions["frame"]?.forEach((cb) =>
      cb("player-1", {
        frame: 68,
        keys: {},
        events: [],
        playerId: "player-1",
        stateFrame: 60,
        stateHash: "self-echo",
      })
    );

    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reports each desynced frame only once", () => {
    const { instance, gameModel } = buildConnection();
    instance.testSubscribeFrame("room");

    instance.testMaybeHashState(gameModel);

    const remoteFrame = {
      frame: 68,
      keys: {},
      events: [],
      playerId: "player-2",
      stateFrame: 60,
      stateHash: "different",
    };
    instance.subscriptions["frame"]?.forEach((cb) => cb("player-2", remoteFrame));
    instance.subscriptions["frame"]?.forEach((cb) => cb("player-2", remoteFrame));

    // One desync produces a report line plus a snapshot dump; both receipts of
    // the same frame must not repeat the report.
    const desyncReports = errorSpy.mock.calls.filter((call: any[]) => String(call[0]).includes("desync detected"));
    expect(desyncReports).toHaveLength(1);
  });
});

describe("adaptive input delay", () => {
  it("derives the frame offset from one-way latency plus one frame of headroom", () => {
    // ceil(rtt / 2 / 16.667) + 1, clamped to [2, 12]
    expect(frameOffsetForRtt(3)).toBe(2); // LAN: not stuck at the default 8
    expect(frameOffsetForRtt(30)).toBe(2);
    expect(frameOffsetForRtt(100)).toBe(4);
    expect(frameOffsetForRtt(233)).toBe(8);
    expect(frameOffsetForRtt(400)).toBe(12); // 13 clamped
    expect(frameOffsetForRtt(2000)).toBe(12);
  });

  it("falls back to the default offset when no RTT is available", () => {
    expect(frameOffsetForRtt(0)).toBe(8);
    expect(frameOffsetForRtt(Number.NaN)).toBe(8);
    expect(frameOffsetForRtt(-5)).toBe(8);
  });

  it("honors an explicit per-game frameOffset option", () => {
    const inputManager = {} as InputManager;
    const player = { netId: "p", uniqueId: "p", token: "t", config: {} };
    const instance = new TestConnection<any>(player as any, inputManager, { frameOffset: 3 });
    expect(instance.frameOffset).toBe(3);

    instance.receivePong(300);
    expect(instance.frameOffset).toBe(3);
  });

  it("adapts the offset from measured RTT while no room is active", () => {
    const { instance, gameModel } = buildConnection();

    instance.receivePong(100);

    expect(instance.frameOffset).toBe(frameOffsetForRtt(100));
    expect(gameModel.ping).toBe(100);
  });

  it("does not change the offset once a room is active", () => {
    const { instance } = buildConnection();
    instance.localPlayers[0].currentRoomId = "room";

    instance.receivePong(100);

    expect(instance.frameOffset).toBe(8);
  });

  it("answers remote pings and ignores its own echo", () => {
    const { instance } = buildConnection();
    const emitSpy = vi.spyOn(instance, "emit").mockImplementation(() => {});

    instance.subscriptions["yagePing"]?.forEach((cb) => cb("player-1", "n1"));
    expect(emitSpy).not.toHaveBeenCalled();

    instance.subscriptions["yagePing"]?.forEach((cb) => cb("player-2", "n2"));
    expect(emitSpy).toHaveBeenCalledWith("yagePong", "n2");
  });

  it("smooths RTT samples", () => {
    const { instance, gameModel } = buildConnection();

    instance.receivePong(100);
    instance.receivePong(200);

    // 100 * 0.7 + 200 * 0.3 = 130
    expect(instance.rttMs).toBe(130);
    expect(gameModel.ping).toBe(130);
  });
});

describe("two-peer desync detection over the wire", () => {
  let errorSpy: any;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  // Two instances wired directly together: one's emit fires the other's
  // subscriptions, like a transport would.
  class PairedConnection<T> extends CoreConnectionInstance<T> {
    peer: PairedConnection<T> | null = null;

    emit(event: string, ...args: any[]) {
      if (!this.peer || event === "message") {
        return;
      }
      const once = this.peer.onceSubscriptions[event];
      if (once) {
        once.forEach((callback) => callback(this.player.netId, ...args));
        this.peer.onceSubscriptions[event] = [];
      }
      const subs = this.peer.subscriptions[event];
      if (subs) {
        subs.forEach((callback) => callback(this.player.netId, ...args));
      }
    }
  }

  const buildPair = (divergentB: boolean) => {
    const inputManager = {
      buildKeyMap: () => ({}),
      getKeyMap: () => ({}),
      keyMapToJsonObject: () => ({}),
      toKeyMap: (keys: any) => keys,
    } as unknown as InputManager;
    const makeInstance = (netId: string) =>
      new PairedConnection<any>({ netId, uniqueId: netId, token: "t", config: {} } as any, inputManager, {});
    const a = makeInstance("player-a");
    const b = makeInstance("player-b");
    a.peer = b;
    b.peer = a;

    const makeModel = (frame: number, divergent: boolean) => ({
      roomId: "room",
      frame,
      executionMode: "realtime",
      ping: 0,
      useStubHash: true,
      divergent,
      serializeState: vi.fn(() => ({ frame })),
    });
    a.roomStates["room"] = { gameModel: makeModel(60, false) as any, frameStack: {}, lastFrame: {} };
    b.roomStates["room"] = { gameModel: makeModel(60, divergentB) as any, frameStack: {}, lastFrame: {} };
    for (const instance of [a, b]) {
      instance.history["room"] = {
        frames: {},
        seed: "s",
        startTimestamp: 0,
        configs: {},
        stateHashes: {},
        snapshots: {},
      };
      (instance as any).subscribeFrame("room");
    }
    return { a, b };
  };

  it("stays silent when both peers hash the same state", () => {
    const { a, b } = buildPair(false);

    a.publishState(a.roomStates["room"], "player-a", a.roomStates["room"].gameModel as any);
    b.publishState(b.roomStates["room"], "player-b", b.roomStates["room"].gameModel as any);

    expect(errorSpy.mock.calls.filter((call: any[]) => String(call[0]).includes("desync detected"))).toHaveLength(0);
  });

  it("reports when a peer's hash diverges", () => {
    const { a, b } = buildPair(true);

    a.publishState(a.roomStates["room"], "player-a", a.roomStates["room"].gameModel as any);
    // B's sim reaches frame 60 and hashes its (divergent) state.
    (b as any).maybeHashState(b.roomStates["room"].gameModel);

    const reports = errorSpy.mock.calls.filter((call: any[]) => String(call[0]).includes("desync detected"));
    expect(reports).toHaveLength(1);
    expect(String(reports[0][0])).toContain("player-a");
    expect(b.history["room"].snapshots[60]).toBeDefined();
  });
});
