import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CoreConnectionInstance } from "../../engine/connection/CoreConnectionInstance";
import { InputManager } from "../../engine/inputs/InputManager";
import { PlayerEventManager } from "../../engine/inputs/PlayerEventManager";
import { GameModel } from "../../engine/game/GameModel";
import type { Room } from "../../engine/connection/ConnectionInstance";
import type { GameInstance } from "../../engine/game/GameInstance";
import { PlayerInput } from "yage/schemas/core/PlayerInput";

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
    destroy: vi.fn(),
    deserializeState: vi.fn(),
    serializeState: vi.fn(),
    getComponentsByCategory: vi.fn(),
    getComponentActives: vi.fn(),
    hasComponent: vi.fn(),
    getTypedUnsafe: vi.fn(),
    runGlobalMods: vi.fn(),
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
      destroy: vi.fn(),
      deserializeState: vi.fn(),
      serializeState: vi.fn(),
      getComponentsByCategory: vi.fn(),
      getComponentActives: vi.fn(),
      hasComponent: vi.fn(),
      getTypedUnsafe: vi.fn(),
      runGlobalMods: vi.fn(),
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

      expect(instance.stateRequested).toEqual([["player-2", playerConfig]]);
    });

    it("should send state to joining players", () => {
      const roomId = "test-room";
      const gameModel = {
        roomId,
        frame: 10,
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
      instance.stateRequested = [["player-2", {}]];

      instance.endFrame(gameModel);

      expect(instance.emit).toHaveBeenCalledWith("state", expect.any(String), expect.any(Object), expect.any(Number));
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
