import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoreConnectionInstance } from "../../engine/connection/CoreConnectionInstance";
import { InputManager } from "../../engine/inputs/InputManager";
import { PlayerEventManager } from "../../engine/inputs/PlayerEventManager";
import { GameModel } from "../../engine/game/GameModel";
import type { Room } from "../../engine/connection/ConnectionInstance";
import type { GameInstance } from "../../engine/game/GameInstance";
import { PlayerInput } from "yage/schemas/core/PlayerInput";

// Wire-level tests flag their mocked game models to opt into a deterministic
// stub hash; the mocked GameModel factory below cannot feed the real
// hashWorldState, which needs a live minecs world.
vi.mock("yage/game/StateHash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("yage/game/StateHash")>();
  return {
    hashWorldState: (world: any) =>
      world?.useStubHash ? `stub-${world.roomId}-${world.frame}` : actual.hashWorldState(world),
  };
});

// Mock dependencies
vi.mock("../../engine/inputs/InputManager");
vi.mock("../../engine/inputs/TouchListener");
vi.mock("../../engine/inputs/PlayerEventManager");
vi.mock("../../engine/game/GameModel", () => ({
  GameModel: vi.fn().mockReturnValue({
    roomId: "test-room",
    seed: "test-seed",
    frame: 0,
    paused: false,
    localNetIds: [],
    useStubHash: true,
    destroy: vi.fn(),
    deserializeState: vi.fn(),
    serializeState: vi.fn(),
    getComponentsByCategory: vi.fn(),
    getComponentActives: vi.fn(),
    hasComponent: vi.fn(),
    getTypedUnsafe: vi.fn(),
    runGlobalMods: vi.fn(),
    stepDraw: vi.fn(),
  }),
  GameModelState: {},
}));
vi.mock("nanoid", () => ({
  nanoid: () => "test-id",
}));

// Create a test subclass to access protected methods
class TestCoreConnectionInstance<T> extends CoreConnectionInstance<T> {
  public testCreatePlayer(gameModel: GameModel, playerId: string, playerConfig: T, frame: number) {
    return this.createPlayer(gameModel, playerId, playerConfig, frame);
  }

  public testSubscribeFrame(roomId: string) {
    return this.subscribeFrame(roomId);
  }

  public testBuildWorld(gameModel: GameModel, firstPlayerConfig: any, buildWorld: any) {
    return this.buildWorld(gameModel, firstPlayerConfig, buildWorld);
  }

  emit(event: string, ...args: any[]) {
    console.log("EMMITING", event, args);
    if (event !== "message") {
      if (this.onceSubscriptions[event]) {
        this.onceSubscriptions[event].forEach((callback) => {
          callback(this.player.netId, ...args);
        });
        this.onceSubscriptions[event] = [];
      }
      if (this.subscriptions[event]) {
        this.subscriptions[event].forEach((callback) => {
          callback(this.player.netId, ...args);
        });
      }
    }
  }

  async connect(): Promise<void> {
    super.connect();
    this.player.connected = true;
    this.roomSyncResolve();
    this.player.connectionTime = Date.now();
    this.emit("connect", this.player);
  }
}

describe("consumePlayerFrame join boundary", () => {
  const buildHarness = () => {
    const instance = new TestCoreConnectionInstance<any>(
      { netId: "p1", uniqueId: "p1", token: "t", config: {} } as any,
      {
        buildKeyMap: () => new Map(),
        getKeyMap: () => new Map(),
        keyMapToJsonObject: () => ({}),
        toKeyMap: (keys: any) => keys,
      } as any,
      {},
    );
    instance.history["test-room"] = {
      seed: "s",
      startTimestamp: 0,
      frames: {},
      configs: {},
      stateHashes: {},
      snapshots: {},
    };
    const playerInput = {
      keyMap: new Map(),
      prevKeyMap: new Map(),
      events: ["stale"],
      pid: "p2",
    };
    const roomState: any = { frameStack: { p2: [] }, lastFrame: {} };
    const gameModel: any = { frame: 100, executionMode: "realtime", roomId: "test-room" };
    return { instance, playerInput, roomState, gameModel };
  };

  it("skips gracefully when the joiner's frame stack is empty (no frames yet)", () => {
    const { instance, playerInput, roomState, gameModel } = buildHarness();
    gameModel.frame = 120;

    expect(() =>
      (instance as any).consumePlayerFrame(roomState, "p2", playerInput, gameModel),
    ).not.toThrow();
    // No frame consumed, but the prev-key chain keeps advancing so
    // keyPressed stays consistent on every peer.
    expect(playerInput.events).toEqual([]);
  });

  it("skips gracefully when the joiner's first published frame is ahead of the local frame", () => {
    const { instance, playerInput, roomState, gameModel } = buildHarness();
    // Joiner synced at host frame 130: its publishes start ahead of us.
    roomState.frameStack.p2 = [
      { frame: 130, keys: new Map([["right", true]]), events: [], playerId: "p2" },
    ];

    expect(() =>
      (instance as any).consumePlayerFrame(roomState, "p2", playerInput, gameModel),
    ).not.toThrow();
    expect(roomState.frameStack.p2).toHaveLength(1);
  });

  it("consumes normally when the head matches the local frame", () => {
    const { instance, playerInput, roomState, gameModel } = buildHarness();
    roomState.frameStack.p2 = [
      { frame: 100, keys: new Map([["right", true]]), events: ["hit"], playerId: "p2" },
    ];

    (instance as any).consumePlayerFrame(roomState, "p2", playerInput, gameModel);

    expect(playerInput.keyMap.get("right")).toBe(true);
    expect(playerInput.events).toEqual(["hit"]);
    expect(roomState.frameStack.p2).toHaveLength(0);
  });
});

describe("CoreConnectionInstance", () => {
  let instance: TestCoreConnectionInstance<any>;
  let inputManager: InputManager;
  let playerEventManager: PlayerEventManager;
  let mockPlayer: any;
  let mockOptions: any;
  let mockGameInstance: GameInstance<any>;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    (GameModel as any).mockReturnValue({
      roomId: "test-room",
      seed: "test-seed",
      frame: 0,
      paused: false,
      localNetIds: [],
      useStubHash: true,
      destroy: vi.fn(),
      deserializeState: vi.fn(),
      serializeState: vi.fn(),
      getComponentsByCategory: vi.fn(),
      getComponentActives: vi.fn(),
      hasComponent: vi.fn(),
      getTypedUnsafe: vi.fn(),
      runGlobalMods: vi.fn(),
      stepDraw: vi.fn(),
    });

    // Setup mock input manager
    inputManager = {
      keyMapsByType: {},
      changes: [],
      keyListeners: [],
      keyMap: vi.fn(),
      getKeyMap: vi.fn(),
      combineKeyMaps: true,
      toKeyMap: vi.fn(),
      clone: vi.fn(),
      addKeyListener: vi.fn(),
      removeKeyListener: vi.fn(),
      dispatchEvent: vi.fn(),
      keyMapToJsonObject: vi.fn(),
      keyPressed: vi.fn(),
      buildKeyMap: vi.fn().mockReturnValue({}),
    } as unknown as InputManager;

    // Setup mock player
    mockPlayer = {
      netId: "player-1",
      uniqueId: "player-1",
      token: "token-1",
      config: {},
      inputType: "keyboard",
      inputIndex: 0,
      connected: true,
      connectionTime: Date.now(),
      currentRoomId: null,
      roomsSynced: false,
      hostedRooms: [],
    };

    // Setup mock game instance
    mockGameInstance = {
      options: {
        connection: {
          inputManager,
        },
      },
    } as unknown as GameInstance<any>;

    // Setup mock options
    mockOptions = {
      touchRegions: [],
      roomTimeout: 5000,
      roomPersist: false,
    };

    // Create instance
    instance = new TestCoreConnectionInstance(mockPlayer, inputManager, mockOptions);
  });

  afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
  });

  // ... (previous test cases remain the same until Room Management)

  describe("Room Joining", () => {
    it("should throw error when joining while not connected", async () => {
      mockPlayer.connected = false;
      instance = new TestCoreConnectionInstance(mockPlayer, inputManager, mockOptions);

      await expect(
        instance.join("test-room", {
          onPlayerJoin: vi.fn(),
          onPlayerLeave: vi.fn(),
          gameInstance: mockGameInstance,
          seed: "test-seed",
        })
      ).rejects.toThrow("Not connected");
    });

    it("should handle room join timeout", async () => {
      vi.useFakeTimers();
      instance.player.connected = true;
      const joinPromise = instance.join("test-room", {
        onPlayerJoin: vi.fn(),
        onPlayerLeave: vi.fn(),
        gameInstance: mockGameInstance,
        seed: "test-seed",
      });

      vi.advanceTimersByTime(mockOptions.roomTimeout + 100);

      await expect(joinPromise).rejects.toThrow("Timed out looking for room");
    });

    it("should successfully join room", async () => {
      instance.player.connected = true;
      const roomId = "test-room";
      const room: Room = {
        roomId,
        players: ["player-1"],
        host: "player-1",
        rebalanceOnLeave: false,
      };

      // Setup room update handler
      setTimeout(() => {
        instance.rooms[roomId] = room;
        instance.onceSubscriptions["updateRoom"]?.forEach((cb) => cb("player-1", room));
      }, 100);

      // Setup state handler
      setTimeout(() => {
        instance.onceSubscriptions["state"]?.forEach((cb) => cb("other-player", JSON.stringify({ test: true }), {}));
      }, 200);

      const gameModel = await instance.join(roomId, {
        onPlayerJoin: vi.fn(),
        onPlayerLeave: vi.fn(),
        gameInstance: mockGameInstance,
        seed: "test-seed",
      });

      expect(gameModel).toBeDefined();
      expect(instance.player.currentRoomId).toBe(roomId);
    });

    it("tracks remote room joins without moving the local player", () => {
      instance.players.push({
        ...instance.player,
        netId: "player-2",
        currentRoomId: "old-room",
        connected: true,
      });
      instance.rooms["old-room"] = {
        roomId: "old-room",
        players: ["player-1", "player-2"],
        host: "player-1",
        rebalanceOnLeave: false,
      };

      instance.subscriptions["joinRoom"]?.forEach((cb) => cb("player-2", "new-room"));

      expect(instance.rooms["old-room"].players).toEqual(["player-1"]);
      expect(instance.rooms["new-room"].players).toEqual(["player-2"]);
      expect(instance.players.find((player) => player.netId === "player-2")?.currentRoomId).toBe("new-room");
      expect(instance.player.currentRoomId).toBeNull();
    });

    it("handles remote leaves for rooms that are not locally simulated", () => {
      instance.players.push({
        ...instance.player,
        netId: "player-2",
        currentRoomId: "remote-room",
        connected: true,
      });

      expect(() => {
        instance.subscriptions["leaveRoom"]?.forEach((cb) => cb("player-2", "remote-room", 120));
      }).not.toThrow();
      expect(instance.players.find((player) => player.netId === "player-2")?.currentRoomId).toBeNull();
    });

    it("uses remote state sync when activating a preloaded room that already has peers", async () => {
      const sourceRoomId = "source-room";
      const roomId = "remote-room";
      const sourceModel = {
        roomId: sourceRoomId,
        frame: 40,
        destroyed: false,
        localNetIds: ["player-1"],
      } as unknown as GameModel;
      const preloadedModel = {
        roomId,
        frame: 80,
        destroyed: false,
        localNetIds: [],
        destroy: vi.fn(),
      } as unknown as GameModel;
      instance.player.connected = true;
      instance.player.currentRoomId = sourceRoomId;
      instance.roomStates[sourceRoomId] = { gameModel: sourceModel, frameStack: {}, lastFrame: {} };
      instance.roomStates[roomId] = { gameModel: preloadedModel, frameStack: {}, lastFrame: {} };
      instance.preloadedRoomIds.add(roomId);
      instance.rooms[sourceRoomId] = {
        roomId: sourceRoomId,
        players: ["player-1"],
        host: "player-1",
        rebalanceOnLeave: false,
      };
      instance.rooms[roomId] = {
        roomId,
        players: ["player-2"],
        host: "player-2",
        rebalanceOnLeave: false,
      };
      const leaveRoom = vi.spyOn(instance, "leaveRoom").mockImplementation(() => {
        instance.player.currentRoomId = null;
      });
      const join = vi.spyOn(instance, "join").mockResolvedValue(preloadedModel);

      const result = await instance.activatePreloadedRoom(roomId, {
        gameInstance: mockGameInstance,
        seed: "test-seed",
        onPlayerJoin: vi.fn(),
        onPlayerLeave: vi.fn(),
      });

      expect(result).toBe(preloadedModel);
      expect(leaveRoom).toHaveBeenCalledWith(sourceRoomId, 40, 0);
      expect((preloadedModel as any).destroy).not.toHaveBeenCalled();
      expect(instance.roomStates[roomId].gameModel).toBeNull();
      expect(instance.preloadedRoomIds.has(roomId)).toBe(false);
      expect(join).toHaveBeenCalledWith(
        roomId,
        expect.objectContaining({
          gameInstance: mockGameInstance,
          seed: "test-seed",
          localPlayerIndex: 0,
        })
      );
    });

    it("merges preloaded frame stacks before the preload game model exists", () => {
      const roomId = "remote-room";
      instance.roomStates[roomId] = {
        gameModel: null as any,
        frameStack: {},
        lastFrame: {},
      };
      (inputManager.toKeyMap as any).mockImplementation((keys: any) => keys);

      expect(() => {
        (instance as any).mergeSerializedFrameStack(
          instance.roomStates[roomId],
          {
            "player-2": [{ frame: 12, keys: { up: true }, events: ["jump"] }],
          },
          roomId
        );
      }).not.toThrow();

      expect(instance.roomStates[roomId].frameStack["player-2"][0]).toEqual({
        frame: 12,
        keys: { up: true },
        events: ["jump"],
        playerId: "player-2",
        roomId,
      });
    });
  });

  describe("Scheduled room events", () => {
    it("returns only the events scheduled for the requested player and frame", () => {
      instance.scheduledRoomEvents["test-room"] = {
        "player-1": { 4: ["move", "collect"] },
      };

      expect(instance.scheduledRoomEventsForFrame("test-room", "player-1", 4)).toEqual(["move", "collect"]);
      expect(instance.scheduledRoomEventsForFrame("test-room", "player-1", 5)).toEqual([]);
      expect(instance.scheduledRoomEventsForFrame("test-room", "player-2", 4)).toEqual([]);
    });
  });

  describe("Room Hosting", () => {
    it("should successfully host a room", async () => {
      const roomId = "test-room";
      const seed = "test-seed";
      const buildWorld = vi.fn();
      const onPlayerJoin = vi.fn().mockReturnValue(1);
      const onPlayerLeave = vi.fn();

      const gameModel = await instance.host(roomId, {
        gameInstance: mockGameInstance,
        seed,
        buildWorld,
        onPlayerJoin,
        onPlayerLeave,
      });

      expect(gameModel).toBeDefined();
      expect(instance.player.currentRoomId).toBe(roomId);
      expect(instance.player.hostedRooms).toContain(roomId);
      expect(buildWorld).toHaveBeenCalled();
      expect(onPlayerJoin).toHaveBeenCalled();
    });

    it("should handle room persistence", async () => {
      const roomId = "test-room";

      // Setup persisted room
      instance.persistTimeouts[roomId] = setTimeout(() => {}, 1000);
      instance.roomStates[roomId] = {
        gameModel: {} as GameModel,
        frameStack: {},
        lastFrame: {},
      };

      const gameModel = await instance.host(roomId, {
        gameInstance: mockGameInstance,
        seed: "test-seed",
        buildWorld: vi.fn(),
        onPlayerJoin: vi.fn(),
        onPlayerLeave: vi.fn(),
      });

      expect(gameModel).toBe(instance.roomStates[roomId].gameModel);
    });
  });

  describe("State Synchronization", () => {
    it("should handle state requests", async () => {
      const roomId = "test-room";
      const playerConfig = { test: true };

      instance.emit = vi.fn();
      instance.setupStateRequest(mockPlayer, roomId);

      // Simulate state request
      instance.subscriptions["requestState"]?.forEach((cb) => cb("player-2", roomId, JSON.stringify(playerConfig)));

      expect(instance.stateRequested).toEqual([{ roomId, playerId: "player-2", playerConfig }]);
    });

    it("keeps state requests scoped to their requested room", () => {
      instance.setupStateRequest(mockPlayer, "room-a");
      instance.setupStateRequest(mockPlayer, "room-b");

      instance.subscriptions["requestState"]?.forEach((cb) => cb("player-2", "room-b", JSON.stringify({ test: true })));

      expect(instance.stateRequested).toEqual([
        { roomId: "room-b", playerId: "player-2", playerConfig: { test: true } },
      ]);
    });

    it("should send state to joining players", () => {
      const roomId = "test-room";
      const gameModel = {
        roomId,
        frame: 10,
        localNetIds: ["player-1"],
        serializeState: vi.fn().mockReturnValue({ test: true }),
        runGlobalMods: vi.fn(),
      } as unknown as GameModel;

      instance.rooms[roomId] = {
        roomId,
        players: ["player-1", "player-2"],
        host: "player-1",
        rebalanceOnLeave: false,
      };

      instance._onPlayerJoin = vi.fn();

      instance.roomStates[roomId] = {
        gameModel,
        frameStack: {
          "player-1": [{ frame: 10, keys: {}, events: [], playerId: "player-1" }],
        },
        lastFrame: { "player-1": 10 },
      };

      instance.emit = vi.fn();
      instance.stateRequested = [{ roomId, playerId: "player-2", playerConfig: {} }];

      instance.endFrame(gameModel);

      expect(instance.emit).toHaveBeenCalledWith(
        "state",
        expect.any(String),
        expect.any(Object),
        expect.any(Number),
        expect.any(Object)
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle missing room frame stack", () => {
      const gameModel = {
        roomId: "test-room",
        frame: 10,
        getComponentActives: vi.fn().mockReturnValue([1]),
      } as unknown as GameModel;

      expect(() => instance.frameSkipCheck(gameModel)).toThrow("no room frame stack");
    });

    it("should handle frame drops", () => {
      const gameModel = {
        roomId: "test-room",
        frame: 10,
        getComponentActives: vi.fn().mockReturnValue([1]),
        hasComponent: vi.fn().mockReturnValue(true),
        getTypedUnsafe: vi.fn().mockReturnValue({ pid: "player-1" }),
      } as unknown as GameModel;

      instance.roomStates[gameModel.roomId] = {
        gameModel,
        frameStack: {
          "player-1": [],
        },
        lastFrame: {},
      };

      const result = instance.frameSkipCheck(gameModel);
      expect(result).toBe(true);
    });

    it("should request and accept a resent missing frame when a future frame arrives first", () => {
      const roomId = "test-room";
      const gameModel = {
        roomId,
        frame: 10,
        getComponentActives: vi.fn().mockReturnValue([1]),
        hasComponent: vi.fn().mockReturnValue(true),
        getTypedUnsafe: vi.fn().mockReturnValue({ pid: "player-2" }),
      } as unknown as GameModel;

      instance.roomStates[roomId] = {
        gameModel,
        frameStack: {
          "player-2": [{ frame: 11, keys: {}, events: [], playerId: "player-2" }],
        },
        lastFrame: { "player-2": 11 },
      };
      (inputManager.toKeyMap as any).mockImplementation((keys: any) => keys);
      instance.testSubscribeFrame(roomId);

      const emitSpy = vi.spyOn(instance, "emit");
      const result = instance.frameSkipCheck(gameModel);

      expect(result).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith("missedFrame", roomId, "player-2", 10);

      instance.subscriptions["frame"]?.forEach((cb) =>
        cb("player-2", { frame: 10, keys: { left: true }, events: ["jump"], playerId: "player-2" })
      );

      expect(instance.roomStates[roomId].frameStack["player-2"].map((frame) => frame.frame)).toEqual([10, 11]);
      expect(instance.roomStates[roomId].frameStack["player-2"][0]).toEqual({
        frame: 10,
        keys: { left: true },
        events: ["jump"],
        playerId: "player-2",
        roomId,
      });
    });
  });

  describe("Frame Processing", () => {
    beforeEach(() => {
      instance.history["test-room"] = {
        frames: {
          "player-1": [],
        },
        seed: "0",
        startTimestamp: 0,
        configs: [],
        stateHashes: [],
        snapshots: {},
      };
    });
    it("should process frame transitions correctly", () => {
      const roomId = "test-room";
      const gameModel = {
        roomId,
        frame: 10,
        getComponentActives: vi.fn().mockReturnValue([1]),
        hasComponent: vi.fn().mockReturnValue(true),
        getTypedUnsafe: vi.fn().mockReturnValue({
          pid: "player-1",
          keyMap: {},
          prevKeyMap: {},
          events: [],
        }),
      } as unknown as GameModel;

      instance.roomStates[roomId] = {
        gameModel,
        frameStack: {
          "player-1": [
            {
              frame: 10,
              keys: {},
              events: [],
              playerId: "player-1",
            },
          ],
        },
        lastFrame: { "player-1": 9 },
      };

      instance.emit = vi.fn();
      instance.startFrame(gameModel);

      expect(gameModel.getComponentActives).toHaveBeenCalledWith("PlayerInput");
      expect(gameModel.hasComponent).toHaveBeenCalledWith(PlayerInput, 1);
    });

    it("should update player input during frame processing", () => {
      const roomId = "test-room";
      const gameModel = {
        roomId,
        frame: 10,
        getComponentActives: vi.fn().mockReturnValue([1]),
        hasComponent: vi.fn().mockReturnValue(true),
        getTypedUnsafe: vi.fn().mockReturnValue({
          pid: "player-1",
          keyMap: { up: false },
          prevKeyMap: {},
          events: [],
        }),
      } as unknown as GameModel;

      const newKeyMap = { up: true };
      instance.roomStates[roomId] = {
        gameModel,
        frameStack: {
          "player-1": [
            {
              frame: 10,
              keys: newKeyMap,
              events: ["jump"],
              playerId: "player-1",
            },
          ],
        },
        lastFrame: { "player-1": 9 },
      };

      instance.consumePlayerFrame(
        instance.roomStates[roomId],
        "player-1",
        gameModel.getTypedUnsafe(PlayerInput, 1),
        gameModel
      );

      const playerInput = gameModel.getTypedUnsafe(PlayerInput, 1);
      expect(playerInput.prevKeyMap).toEqual({ up: false });
      expect(playerInput.events).toEqual(["jump"]);
    });

    it("should record replay history through the persistence flow", () => {
      const roomId = "test-room";
      const recordFrame = vi.fn();
      const persistIfDue = vi.fn();
      (instance as any).historyPersistenceFlow = {
        recordFrame,
        persistIfDue,
      };
      (inputManager.keyMapToJsonObject as any).mockReturnValue({});

      const gameModel = { roomId, frame: 300 } as unknown as GameModel;
      const frame = { frame: 300, keys: {}, events: [], playerId: "player-1" };

      instance.updateHistory("player-1", frame, gameModel);

      expect(recordFrame).toHaveBeenCalledWith(roomId, "player-1", {
        frame: 300,
        keys: {},
        events: [],
        playerId: "player-1",
      });
      expect(persistIfDue).toHaveBeenCalledWith(300);
    });
  });

  describe("Player Event Management", () => {
    it("should handle player events during frame processing", () => {
      const roomId = "test-room";
      const gameModel = {
        roomId,
        frame: 10,
      } as unknown as GameModel;

      const events = ["jump", "shoot"];
      instance.playerEventManager.getEvents = vi.fn().mockReturnValue(events);
      (inputManager.keyMapToJsonObject as any).mockReturnValue({});
      (inputManager.getKeyMap as any).mockReturnValue({});

      instance.roomStates[roomId] = {
        gameModel,
        frameStack: {
          [mockPlayer.netId]: new Array(instance.frameOffset).fill({ frame: 0 }),
        },
        lastFrame: {},
      };

      instance.emit = vi.fn();
      instance.publishState(instance.roomStates[roomId], mockPlayer.netId, gameModel);

      expect(instance.emit).toHaveBeenCalledWith(
        "frame",
        expect.objectContaining({
          events,
          playerId: mockPlayer.netId,
        })
      );
    });
  });

  describe("Player Connection Management", () => {
    it("should handle player connection updates", () => {
      const updateInfo = {
        name: "new-name",
        token: "new-token",
        config: { test: true },
      };

      instance.emit = vi.fn();
      instance.updatePlayerConnect(updateInfo);

      expect(instance.localPlayers[0].uniqueId).toBe("new-name");
      expect(instance.localPlayers[0].token).toBe("new-token");
      expect(instance.localPlayers[0].config).toEqual({ test: true });
      expect(instance.emit).toHaveBeenCalledWith("updatePlayerConnect", instance.localPlayers[0]);
    });

    it("should handle player disconnection cleanup", () => {
      const roomId = "test-room";
      const lastFrame = 10;

      instance.rooms[roomId] = {
        roomId,
        players: ["player-1", "player-2"],
        host: "player-1",
        rebalanceOnLeave: false,
      };

      instance.players[1] = {
        ...instance.players[0],
        netId: "player-2",
        currentRoomId: roomId,
      };

      instance.roomStates[roomId] = {
        gameModel: {} as GameModel,
        frameStack: {
          "player-2": [{ frame: 0, keys: {}, events: [], playerId: "player-2" }],
        },
        lastFrame: { "player-2": 0 },
      };

      const disconnectListener = vi.fn();
      instance.onPlayerDisconnect(disconnectListener);

      // Simulate player disconnection
      instance.subscriptions["userDisconnect"]?.forEach((cb) => cb("player-2", lastFrame));

      expect(instance.players).not.toContain("player-2");
      expect(disconnectListener).toHaveBeenCalledWith("player-2");
      expect(instance.disconnectingPlayers).toContainEqual(["player-2", lastFrame]);
    });

    it("should schedule disconnected player removal on the shared disconnect frame", () => {
      const roomId = "test-room";
      const onPlayerLeave = vi.fn();
      const gameModel = {
        roomId,
        frame: 9,
        players: [100, 200],
        getComponentsByCategory: vi.fn().mockReturnValue([]),
      } as unknown as GameModel;

      instance.rooms[roomId] = {
        roomId,
        players: ["player-1", "player-2"],
        host: "player-1",
        rebalanceOnLeave: false,
      };
      instance.players[1] = {
        ...instance.players[0],
        netId: "player-2",
        currentRoomId: roomId,
      };
      instance.roomStates[roomId] = {
        gameModel,
        frameStack: {
          "player-2": [{ frame: 9, keys: {}, events: [], playerId: "player-2" }],
        },
        lastFrame: { "player-2": 9 },
      };
      instance._onPlayerLeave = onPlayerLeave;

      instance.subscriptions["userDisconnect"]?.forEach((cb) => cb("player-2"));

      expect(instance.leavingPlayers[roomId]).toContainEqual(["player-2", 10]);

      (gameModel as any).frame = 10;
      instance.handleLeavingPlayers(gameModel, instance.roomStates[roomId].frameStack);

      expect(onPlayerLeave).toHaveBeenCalledWith(gameModel, "player-2");
      expect(instance.roomStates[roomId].frameStack["player-2"]).toBeUndefined();
    });

    it("should synthesize the currently blocked frame when a disconnected player queue is empty", () => {
      const roomId = "test-room";
      const gameModel = {
        roomId,
        frame: 656,
        players: [100, 200],
        localNetIds: ["player-1"],
      } as unknown as GameModel;

      instance.rooms[roomId] = {
        roomId,
        players: ["player-1", "player-2"],
        host: "player-1",
        rebalanceOnLeave: false,
      };
      instance.players[1] = {
        ...instance.players[0],
        netId: "player-2",
        currentRoomId: roomId,
      };
      instance.roomStates[roomId] = {
        gameModel,
        frameStack: {
          "player-2": [],
        },
        lastFrame: { "player-2": 655 },
      };

      instance.subscriptions["userDisconnect"]?.forEach((cb) => cb("player-2"));

      expect(instance.roomStates[roomId].frameStack["player-2"][0].frame).toBe(656);
      expect(instance.leavingPlayers[roomId]).toContainEqual(["player-2", 660]);
    });

    it("should disconnect a remote player whose missing frame stalls past the timeout", () => {
      const roomId = "test-room";
      instance = new TestCoreConnectionInstance(mockPlayer, inputManager, { ...mockOptions, disconnectTimeoutMs: 0 });
      const gameModel = {
        roomId,
        frame: 656,
        executionMode: "realtime",
        localNetIds: ["player-1"],
        getComponentActives: vi.fn().mockReturnValue([200]),
        hasComponent: vi.fn().mockReturnValue(true),
        getTypedUnsafe: vi.fn().mockReturnValue({ pid: "player-2" }),
      } as unknown as GameModel;

      instance.rooms[roomId] = {
        roomId,
        players: ["player-1", "player-2"],
        host: "player-1",
        rebalanceOnLeave: false,
      };
      instance.players[1] = {
        ...instance.players[0],
        netId: "player-2",
        currentRoomId: roomId,
      };
      instance.roomStates[roomId] = {
        gameModel,
        frameStack: {
          "player-2": [],
        },
        lastFrame: { "player-2": 655 },
      };

      expect(instance.frameSkipCheck(gameModel)).toBe(true);
      expect(instance.frameSkipCheck(gameModel)).toBe(false);
      expect(instance.leavingPlayers[roomId]).toContainEqual(["player-2", 660]);
      expect(instance.roomStates[roomId].frameStack["player-2"][0].frame).toBe(656);
    });

    it("should track multiple disconnecting players independently", () => {
      const roomId = "test-room";

      instance.rooms[roomId] = {
        roomId,
        players: ["player-1", "player-2", "player-3"],
        host: "player-1",
        rebalanceOnLeave: false,
      };
      instance.players[1] = {
        ...instance.players[0],
        netId: "player-2",
        currentRoomId: roomId,
      };
      instance.players[2] = {
        ...instance.players[0],
        netId: "player-3",
        currentRoomId: roomId,
      };
      instance.roomStates[roomId] = {
        gameModel: { roomId, frame: 9 } as GameModel,
        frameStack: {
          "player-2": [{ frame: 9, keys: {}, events: [], playerId: "player-2" }],
          "player-3": [{ frame: 9, keys: {}, events: [], playerId: "player-3" }],
        },
        lastFrame: { "player-2": 9, "player-3": 19 },
      };

      instance.subscriptions["userDisconnect"]?.forEach((cb) => cb("player-2"));
      instance.subscriptions["userDisconnect"]?.forEach((cb) => cb("player-3"));

      expect(instance.disconnectingPlayers).toContainEqual(["player-2", 10]);
      expect(instance.disconnectingPlayers).toContainEqual(["player-3", 20]);
    });
  });

  describe("Message Handling", () => {
    it("should send messages to all listeners", () => {
      const message = "test message";
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      instance.messageListeners = [listener1, listener2];
      instance.emit = vi.fn();

      instance.sendMessage(message);

      expect(instance.emit).toHaveBeenCalledWith("message", message, expect.any(Number));
      expect(listener1).toHaveBeenCalledWith(message, expect.any(Number), mockPlayer.netId);
      expect(listener2).toHaveBeenCalledWith(message, expect.any(Number), mockPlayer.netId);
    });

    it("should not send message to self when includeSelf is false", () => {
      const message = "test message";
      const listener = vi.fn();

      instance.messageListeners = [listener];
      instance.emit = vi.fn();

      instance.sendMessage(message, false);

      expect(instance.emit).toHaveBeenCalledWith("message", message, expect.any(Number));
      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe("deterministic join start frame", () => {
  const buildHarness = () => {
    const instance = new TestCoreConnectionInstance<any>(
      { netId: "p1", uniqueId: "p1", token: "t", config: {} } as any,
      {
        buildKeyMap: () => new Map(),
        getKeyMap: () => new Map(),
        keyMapToJsonObject: (keys: any) => Object.fromEntries(keys ?? []),
        toKeyMap: (keys: any) => new Map(Object.entries(keys ?? {})),
      } as any,
      {},
    );
    if (!instance.localPlayers.some((player) => player.netId === "p1")) {
      instance.localPlayers.push({
        netId: "p1",
        inputType: "keyboard",
        inputIndex: 0,
      } as any);
    }
    return instance;
  };

  const buildGameModel = (frame: number, pid: string) =>
    ({
      roomId: "test-room",
      frame,
      executionMode: "realtime",
      getComponentActives: vi.fn().mockReturnValue([1]),
      hasComponent: vi.fn().mockReturnValue(true),
      runGlobalMods: vi.fn(),
      getTypedUnsafe: vi.fn().mockReturnValue({
        pid,
        keyMap: new Map(),
        prevKeyMap: new Map(),
        events: [],
      }),
    }) as unknown as GameModel;

  it("advances with no joiner entity below the joiner's start frame", () => {
    const instance = buildHarness();
    const gameModel = buildGameModel(100, "p1");
    (gameModel as any).getComponentActives = vi.fn().mockReturnValue([]);
    instance.roomStates["test-room"] = {
      gameModel,
      frameStack: {},
      lastFrame: {},
      joinStartFrames: { "late-joiner": 220 },
    } as any;

    // No entity exists below the start frame, so frameSkipCheck has nothing
    // to wait on and the room keeps stepping.
    expect(instance.frameSkipCheck(gameModel)).toBe(false);
  });

  it("materializes a pending joiner at its deterministic start frame", () => {
    const instance = buildHarness();
    const gameModel = buildGameModel(220, "p1");
    (gameModel as any).getComponentActives = vi.fn().mockReturnValue([]);
    instance.players.push({ netId: "late-joiner", connected: true } as any);
    instance._onPlayerJoin = vi.fn().mockReturnValue(7) as any;
    instance.roomStates["test-room"] = {
      gameModel,
      frameStack: {},
      lastFrame: {},
      joinStartFrames: { "late-joiner": 220 },
      joinConfigs: { "late-joiner": { side: 2 } },
    } as any;

    instance.startFrame(gameModel);

    expect(instance._onPlayerJoin).toHaveBeenCalledWith(gameModel, "late-joiner", { side: 2 });
    const seeded = instance.roomStates["test-room"].frameStack["late-joiner"];
    expect(seeded.map((frame: any) => frame.frame)).toEqual([220, 221, 222, 223, 224, 225, 226, 227]);
    expect(instance.roomStates["test-room"].joinStartFrames).toEqual({});
  });

  it("does not materialize a pending joiner before its start frame", () => {
    const instance = buildHarness();
    const gameModel = buildGameModel(219, "p1");
    instance._onPlayerJoin = vi.fn().mockReturnValue(7) as any;
    instance.roomStates["test-room"] = {
      gameModel,
      frameStack: {},
      lastFrame: {},
      joinStartFrames: { "late-joiner": 220 },
      joinConfigs: { "late-joiner": { side: 2 } },
    } as any;

    instance.startFrame(gameModel);

    expect(instance._onPlayerJoin).not.toHaveBeenCalled();
    expect(instance.roomStates["test-room"].joinStartFrames).toEqual({ "late-joiner": 220 });
  });

  it("skips materialization for a joiner that left before its start frame", () => {
    const instance = buildHarness();
    const gameModel = buildGameModel(220, "p1");
    instance._onPlayerJoin = vi.fn().mockReturnValue(7) as any;
    instance.rooms["test-room"] = { roomId: "test-room", host: "p1", players: ["p1"], rebalanceOnLeave: false };
    instance.roomStates["test-room"] = {
      gameModel,
      frameStack: {},
      lastFrame: {},
      joinStartFrames: { "gone-joiner": 220 },
      joinConfigs: { "gone-joiner": {} },
    } as any;

    instance.startFrame(gameModel);

    expect(instance._onPlayerJoin).not.toHaveBeenCalled();
    expect(instance.roomStates["test-room"].joinStartFrames).toEqual({});
  });

  it("keeps a local player in the roster when a peer reaps it", () => {
    const instance = buildHarness();
    const gameModel = buildGameModel(100, "p1");
    instance.roomStates["test-room"] = {
      gameModel,
      frameStack: { p1: [] },
      lastFrame: { p1: 100 },
    } as any;
    const disconnectListener = vi.fn();
    instance.disconnectListeners.push(disconnectListener);

    instance.emit("userDisconnect", "p1");

    expect(instance.localPlayers.some((player) => player.netId === "p1")).toBe(true);
    expect(instance.players.some((player) => player.netId === "p1")).toBe(true);
    expect(disconnectListener).toHaveBeenCalledWith("p1");
    // The empty-input fill still covers the dropped frames so every peer
    // consumes the same inputs through the disconnect frame.
    const filled = instance.roomStates["test-room"].frameStack.p1;
    expect(filled.length).toBeGreaterThan(0);
  });

  it("starts RTT pinging only when the first frame begins", () => {
    const instance = buildHarness();
    const gameModel = buildGameModel(0, "p1");
    (gameModel as any).getComponentActives = vi.fn().mockReturnValue([]);
    instance.roomStates["test-room"] = {
      gameModel,
      frameStack: {},
      lastFrame: {},
    } as any;

    expect((instance as any).pingInterval).toBeNull();
    instance.startFrame(gameModel);
    expect((instance as any).pingInterval).not.toBeNull();

    instance.stopRttMeasurement();
  });

  it("adopts the served join start frame over a locally recorded provisional one", () => {
    const instance = buildHarness();
    instance.roomStates["test-room"] = {
      gameModel: buildGameModel(500, "p1"),
      frameStack: {},
      lastFrame: {},
      joinStartFrames: { p2: 999 },
    } as any;
    instance.testSubscribeFrame("test-room");

    instance.subscriptions["state"]?.forEach((cb) =>
      cb("p1", "{}", {}, Date.now(), { p2: 620 })
    );

    expect(instance.roomStates["test-room"].joinStartFrames).toEqual({ p2: 620 });
  });

  it("serves a deterministic join start frame to the group with the state payload", () => {    const instance = buildHarness();
    const gameModel = buildGameModel(300, "p1");
    (gameModel as any).serializeState = vi.fn().mockReturnValue({});
    (gameModel as any).localNetIds = ["p1"];
    instance._onPlayerJoin = vi.fn().mockReturnValue(7) as any;
    instance.rooms["test-room"] = { roomId: "test-room", host: "p1", players: ["p1", "p2"], rebalanceOnLeave: false };
    instance.roomStates["test-room"] = {
      gameModel,
      frameStack: {},
      lastFrame: {},
    } as any;
    (instance as any).stateRequested = [{ roomId: "test-room", playerId: "p2", playerConfig: {} }];
    const emitSpy = vi.spyOn(instance, "emit");

    instance.endFrame(gameModel);

    const stateCall = emitSpy.mock.calls.find(([event]: any[]) => event === "state");
    expect(stateCall?.[4]).toEqual({ p2: 300 + 120 });
    expect(instance.roomStates["test-room"].joinStartFrames).toEqual({ p2: 300 + 120 });
    // Canonical flow: the joiner's entity is NOT created while serving the
    // state — it materializes on every peer at the deterministic frame.
    expect(instance._onPlayerJoin).not.toHaveBeenCalled();
    expect(instance.roomStates["test-room"].joinConfigs).toEqual({ p2: {} });
  });
});

describe("stall detector vs hidden document", () => {
  const buildStalledModel = () =>
    ({
      roomId: "test-room",
      frame: 10,
      getComponentActives: vi.fn().mockReturnValue([1]),
      hasComponent: vi.fn().mockReturnValue(true),
      getTypedUnsafe: vi.fn().mockReturnValue({ pid: "remote-1" }),
    }) as unknown as GameModel;

  const setup = () => {
    const instance = new TestCoreConnectionInstance<any>(
      { netId: "p1", uniqueId: "p1", token: "t", config: {} } as any,
      {
        buildKeyMap: () => new Map(),
        getKeyMap: () => new Map(),
        keyMapToJsonObject: () => ({}),
        toKeyMap: () => new Map(),
      } as any,
      {},
    );
    const gameModel = buildStalledModel();
    instance.roomStates["test-room"] = {
      gameModel,
      frameStack: { "remote-1": [] },
      lastFrame: {},
    } as any;
    return { instance, gameModel };
  };

  it("does not reap a stalled peer while the local document is hidden", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { instance, gameModel } = setup();
    (instance as any).isDocumentHidden = () => true;
    const emitSpy = vi.spyOn(instance, "emit");

    // A suspended rAF retries the same blocked frame for a minute of wall time.
    for (let tick = 0; tick <= 60_000; tick += 1_000) {
      vi.setSystemTime(tick);
      expect(instance.frameSkipCheck(gameModel)).toBe(true);
    }
    expect(emitSpy).not.toHaveBeenCalledWith("userDisconnect", "remote-1");
    vi.useRealTimers();
  });

  it("still reaps a stalled peer after the timeout once the document is visible", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { instance, gameModel } = setup();
    (instance as any).isDocumentHidden = () => false;
    const emitSpy = vi.spyOn(instance, "emit");

    for (let tick = 0; tick <= 4_000; tick += 1_000) {
      vi.setSystemTime(tick);
      instance.frameSkipCheck(gameModel);
    }
    expect(emitSpy).toHaveBeenCalledWith("userDisconnect", "remote-1");
    vi.useRealTimers();
  });
});
