/* eslint-disable @typescript-eslint/no-unused-vars */
import type { PhysicsSaveState } from "yage/systems/physics/Physics";
import { GameModel, GameModelState } from "yage/game/GameModel";
import type { KeyMap } from "yage/inputs/InputManager";
import { InputManager } from "yage/inputs/InputManager";
import type {
  ConnectionInstance,
  Frame,
  PlayerConnect,
  PlayerConnection,
  ReplayStack,
  Room,
  RoomState,
} from "./ConnectionInstance";
import { nanoid } from "nanoid";
import type { RequireAtLeastOne } from "yage/utils/typehelpers";
import { TouchListener } from "yage/inputs/TouchListener";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import type { GameInstance } from "yage/game/GameInstance";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import type { TouchRegion } from "yage/inputs/InputRegion";
import { md5 } from "yage/utils/md5";
import { ComponentCategory } from "yage/constants/enums";
import { SystemImpl } from "minecs";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type CoreConnectionInstanceOptions<T> = {
  touchRegions?: TouchRegion[];
  roomTimeout?: number;
  roomPersist?: boolean | number;
};

export class CoreConnectionInstance<T> implements ConnectionInstance<T> {
  instanceId = nanoid();

  stateRequested: null | [string, any][] = null;
  frameOffset = 8;
  sendingState = false;
  disconnectingPlayers: [string, number][] = [];
  leavingPlayers: { [roomId: string]: [string, number][] } = {};

  roomSyncResolve: () => void = () => {};
  roomSyncPromise: Promise<void> = new Promise((resolve) => {
    this.roomSyncResolve = () => {
      this.player.roomsSynced = true;
      resolve();
    };
  });

  inRoom: string = "";

  nickname: string = "";
  listening: boolean;

  touchListener?: TouchListener | undefined;

  address: string = "";

  subscriptions: { [event: string]: ((playerId: string, ...args: any[]) => void)[] } = {};
  onceSubscriptions: { [event: string]: ((playerId: string, ...args: any[]) => void)[] } = {};

  messageListeners: ((message: string, time: number, playerId: string) => void)[] = [];
  connectListeners: ((player: PlayerConnect<T>) => void)[] = [];
  disconnectListeners: ((playerId: string) => void)[] = [];

  rooms: { [roomId: string]: Room } = {};
  roomStates: { [roomId: string]: RoomState } = {};

  players: PlayerConnection<T>[] = [];
  localPlayers: PlayerConnection<T>[] = [];

  history: {
    [roomId: string]: ReplayStack<T>;
  } = {};

  persistTimeouts: { [roomId: string]: ReturnType<typeof setTimeout> } = {};

  get player(): PlayerConnection<T> {
    if (this.localPlayers.length > 1) {
      throw new Error("Multiple local players");
    }
    return this.localPlayers[0];
  }

  roomSubs: { [roomId: string]: (() => void)[] } = {};

  playerEventManager: PlayerEventManager = new PlayerEventManager();

  emit(event: string, ...args: any[]) {} // eslint-disable-line
  async connect(): Promise<void> {} // eslint-disable-line

  constructor(
    player: PlayerConnect<T> | PlayerConnect<T>[],
    public inputManager: InputManager,
    protected options: CoreConnectionInstanceOptions<T>
  ) {
    options.roomPersist = options.roomPersist ?? false;
    if (options.touchRegions) {
      this.touchListener = new TouchListener(this.inputManager);
    }
    if (!Array.isArray(player)) {
      player = [player];
    }

    for (let i = 0; i < player.length; ++i) {
      const playerConnection = {
        ...player[i],
        connected: false,
        connectionTime: 0,
        currentRoomId: null,
        roomsSynced: false,
        hostedRooms: [],
      };
      this.localPlayers.push(playerConnection);
      this.players.push(playerConnection);
    }

    this.on("message", (playerId: string, message: string, time: number) => {
      this.messageListeners.forEach((listener) => listener(message, time, playerId));
    });
    this.on("updateRoom", (playerId, room: Room) => {
      if (room.players.length === 0) {
        delete this.rooms[room.roomId];
        delete this.roomStates[room.roomId];
        this.roomSubs[room.roomId]?.forEach((sub) => sub());
        delete this.roomSubs[room.roomId];
      } else {
        this.rooms[room.roomId] = room;
      }
    });
    this.on("rooms", (playerId, rooms: { [roomId: string]: Room }) => {
      if (playerId !== this.player.netId) {
        this.rooms = rooms;
        this.roomSyncResolve();
      }
    });
    this.on("connect", (playerId, player: PlayerConnect<T>) => {
      this.connectListeners.forEach((listener) => listener(player));
      if (player.netId !== this.player.netId && this.player.roomsSynced) {
        this.emit("rooms", this.rooms);
      }
    });
    this.on("leaveRoom", (playerId: string, roomId: string, lastFrame: number) => {
      this.rooms[roomId] = {
        ...this.rooms[roomId],
        players: this.rooms[roomId].players.filter((player) => player !== playerId),
      };
      const localId = this.roomStates[roomId]?.gameModel.localNetIds.indexOf(playerId);
      if (localId !== -1) {
        this.roomStates[roomId]?.gameModel.localNetIds.splice(localId, 1);
      }
      this.leavingPlayers[roomId] = this.leavingPlayers[roomId] ?? [];
      this.leavingPlayers[roomId].push([playerId, lastFrame]);

      if (this.rooms[roomId].players.length === 0) {
        if (!this.options.roomPersist) {
          this.roomStates[roomId]?.gameModel.destroy();
          delete this.rooms[roomId];
          delete this.roomStates[roomId];
          this.roomSubs[roomId]?.forEach((sub) => sub());
          delete this.roomSubs[roomId];
        } else if (typeof this.options.roomPersist === "number") {
          this.persistTimeouts[roomId] = setTimeout(() => {
            console.log("DESTROYING");
            this.roomStates[roomId]?.gameModel.destroy();
            delete this.rooms[roomId];
            delete this.roomStates[roomId];
            this.roomSubs[roomId]?.forEach((sub) => sub());
            delete this.roomSubs[roomId];
          }, this.options.roomPersist);
        }
      }
    });

    this.on("joinRoom", (playerId: string, roomId: string) => {
      if (!this.rooms[roomId].players.includes(playerId)) {
        this.rooms[roomId] = {
          ...this.rooms[roomId],
          players: [...this.rooms[roomId].players, playerId],
        };
      }
    });

    this.on("userDisconnect", (playerId: string, lastFrame: number) => {
      const player = this.players.find((player) => player.netId === playerId);
      if (!player) {
        console.error("Something went horribly wrong, player not found", playerId, this.players);
        return;
      }
      this.players = this.players.filter((player) => player.netId !== playerId);
      this.localPlayers = this.localPlayers.filter((player) => player.netId !== playerId);
      this.disconnectListeners.forEach((listener) => listener(playerId));

      const currentRoomId = player.currentRoomId ?? "";

      if (!this.roomStates[currentRoomId]?.frameStack[playerId]) {
        return;
      }
      if (!lastFrame) {
        const room = this.rooms[currentRoomId];
        if (room) {
          this.emit("leaveRoom", playerId, currentRoomId, lastFrame);
        }
      }
      const frameStack = this.roomStates[currentRoomId].frameStack[playerId];
      const gameModel = this.roomStates[currentRoomId].gameModel;
      lastFrame = Math.floor(this.roomStates[currentRoomId].lastFrame[playerId] / 10) * 10 + 10;

      let startingFrame;
      if (frameStack.length === 0) {
        startingFrame = gameModel.frame + 1;
      } else {
        startingFrame = this.roomStates[currentRoomId].lastFrame[playerId] + 1;
      }
      for (let i = startingFrame; i < lastFrame; i += 1) {
        frameStack.push({
          keys: InputManager.buildKeyMap(),
          frame: i,
          events: [],
          playerId: playerId,
        });
      }

      const leavingIndex = this.disconnectingPlayers.findIndex(([playerId]) => playerId === playerId);
      if (leavingIndex !== -1 && this.disconnectingPlayers[leavingIndex][1] < lastFrame) {
        this.disconnectingPlayers[leavingIndex][1] = lastFrame;
      } else if (leavingIndex === -1) {
        this.disconnectingPlayers.push([playerId, lastFrame]);
        this.emit("userDisconnect", lastFrame);
      }
    });

    this.on("updatePlayerConnect", (playerId: string, player: PlayerConnection<T>) => {
      console.log("updatePlayerConnect", "CONNECT CHANGE", this.connectListeners.length);
      this.players = this.players.map((p) => (p.netId === player.netId ? player : p));
      this.connectListeners.forEach((listener) => listener(player));
    });
  }

  async roomHasPlayers(roomId: string): Promise<boolean> {
    await this.roomSyncPromise;
    return !!this.rooms[roomId]?.players.length;
  }

  updatePlayerConnect(
    playerConnect: RequireAtLeastOne<{ name: string; token: string; config: T }, "name" | "token" | "config">,
    index = 0
  ): void {
    const player =
      typeof index === "number" ? this.localPlayers[index] : this.localPlayers.find((player) => player.netId === index);
    if (!player) {
      return;
    }
    player.uniqueId = playerConnect.name ?? player.uniqueId;
    player.token = playerConnect.token ?? player.token;
    player.config = playerConnect.config ?? player.config;

    this.emit("updatePlayerConnect", player);
  }

  leaveRoom(roomId: string, lastFrame: number, localPlayerIndex?: number): void {
    this.listening = false;
    this.sendingState = false;
    this.touchListener?.replaceRegions([]);
    if (localPlayerIndex !== undefined) {
      const player = this.localPlayers[localPlayerIndex];
      if (player.currentRoomId === roomId) {
        this.emit("leaveRoom", player.netId, player.currentRoomId, lastFrame);
        player.currentRoomId = null;
      }
      return;
    }

    for (let i = 0; i < this.localPlayers.length; ++i) {
      const player = this.localPlayers[i];
      if (player.currentRoomId === roomId) {
        this.emit("leaveRoom", player.netId, player.currentRoomId, lastFrame);
        player.currentRoomId = null;
      }
    }
  }

  _onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
  _onPlayerLeave: (gameModel: GameModel, playerId: string) => void;

  async lobby(): Promise<string[]> {
    return [];
  }
  updateRoom(room: Room) {
    this.rooms[room.roomId] = room;
    this.emit("updateRoom", room);
  }

  sendMessage(message: string, includeSelf = true, playerIndex = 0): void {
    const playerId = this.localPlayers[playerIndex].netId;
    this.emit("message", message, +new Date());
    if (includeSelf) {
      this.messageListeners.forEach((listener) => listener(message, +new Date(), playerId));
    }
  }

  onReceiveMessage(cb: (message: string, time: number, playerId: string) => void): () => void {
    this.messageListeners.push(cb);
    return () => {
      this.messageListeners = this.messageListeners.filter((listener) => listener !== cb);
    };
  }

  onPlayerConnect(cb: (player: PlayerConnect<T>) => void): () => void {
    this.connectListeners.push(cb);
    return () => {
      this.connectListeners = this.connectListeners.filter((listener) => listener !== cb);
    };
  }
  onPlayerDisconnect(cb: (playerId: string) => void): () => void {
    this.disconnectListeners.push(cb);
    return () => {
      this.disconnectListeners = this.disconnectListeners.filter((listener) => listener !== cb);
    };
  }

  frameSkipCheck = (gameModel: GameModel): boolean => {
    const room = this.roomStates[gameModel.roomId];
    const frameStack = room?.frameStack;

    if (this.leavingPlayers[gameModel.roomId]?.length) {
      for (let i = 0; i < this.leavingPlayers[gameModel.roomId].length; ++i) {
        if (this.leavingPlayers[gameModel.roomId][i][1] === gameModel.frame) {
          const playerId = this.leavingPlayers[gameModel.roomId][i][0];
          console.log("removing player", this.leavingPlayers[gameModel.roomId][i][0], gameModel.frame);

          const onLeaveComponents = gameModel.getComponentsByCategory(ComponentCategory.ON_LEAVE);
          if (onLeaveComponents.length) {
            const leavingPlayer =
              gameModel.players.find((player) => gameModel.getTypedUnsafe(PlayerInput, player).pid === playerId) ?? -1;

            gameModel.runGlobalMods(ComponentCategory.ON_LEAVE, {
              leavingPlayer,
              playerId,
            });
          }

          this._onPlayerLeave(gameModel, this.leavingPlayers[gameModel.roomId][i][0]);
          delete frameStack[this.leavingPlayers[gameModel.roomId][i][0]];
          this.leavingPlayers[gameModel.roomId].splice(i, 1);
          i--;
        }
      }
    }

    const players = gameModel.getComponentActives("PlayerInput");
    if (!frameStack) {
      console.error("no room frame stack", gameModel.roomId, this.roomStates, this.instanceId);
      throw new Error("no room frame stack");
      return true;
    }
    for (let i = 0; i < players.length; ++i) {
      const player = players[i];
      if (gameModel.hasComponent(PlayerInput, player)) {
        const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
        const netId = playerInput.pid;
        while ((frameStack[netId]?.[0]?.frame ?? Infinity) < gameModel.frame) {
          console.error("old frame received:" + netId);
          frameStack[netId].shift();
        }

        if (!frameStack[netId] || !frameStack[netId][0]) {
          console.error("dropping slow frame", netId, gameModel.frame);
          // console.error(this.frameStack);
          return true;
        }
      }
    }
    return false;
  };

  cleanup() {
    const roomIds = this.localPlayers.map((player) => player.currentRoomId);
    for (let i = 0; i < roomIds.length; ++i) {
      const roomId = roomIds[i];
      if (!roomId) {
        return;
      }
      this.roomSubs[roomId]?.forEach((sub) => sub());
      delete this.roomSubs[roomId];
      delete this.roomStates[roomId];
      delete this.rooms[roomId];
    }
  }

  on(event: string, callback: (playerId: string, ...args: any[]) => void) {
    if (!this.subscriptions[event]) {
      this.subscriptions[event] = [];
    }
    this.subscriptions[event].push(callback);
    return () => {
      this.subscriptions[event] = this.subscriptions[event].filter((cb) => cb !== callback);
    };
  }

  once(event: string, callback: (playerId: string, ...args: any[]) => void) {
    if (!this.onceSubscriptions[event]) {
      this.onceSubscriptions[event] = [];
    }
    this.onceSubscriptions[event].push(callback);
    return () => {
      this.onceSubscriptions[event] = this.onceSubscriptions[event].filter((cb) => cb !== callback);
    };
  }

  protected subscribeFrame(roomId: string) {
    this.roomSubs[roomId] = this.roomSubs[roomId] ?? [];
    if (!this.roomStates[roomId]) {
      this.roomStates[roomId] = {
        gameModel: null as any,
        frameStack: {},
        lastFrame: {},
      };
    }
    const room = this.roomStates[roomId];
    this.roomSubs[roomId].push(
      this.on(
        "frame",
        (playerId, frame: { keys: { [key: string]: boolean }; events: string[]; frame: number; playerId: string }) => {
          const obj = this.inputManager.toKeyMap(frame.keys);
          if (!room.frameStack[frame.playerId]) {
            room.frameStack[frame.playerId] = [];
          }
          const lastFrame = room.lastFrame[frame.playerId] ?? -1;
          if (lastFrame >= frame.frame) {
            return;
          }

          room.frameStack[frame.playerId].push({
            keys: obj,
            frame: frame.frame,
            events: frame.events,
            playerId: frame.playerId,
          });
          room.lastFrame[frame.playerId] = frame.frame;
        }
      )
    );
  }

  async join(
    roomId: string,
    {
      onPlayerJoin,
      onPlayerLeave,
      playerConfig,
      gameInstance,
      seed,
      coreOverrides,
    }: {
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      playerConfig?: Partial<T>;
      gameInstance: GameInstance<T>;
      seed: string;
      coreOverrides?: { [key: string]: any };
    }
  ): Promise<GameModel> {
    if (!this.player.connected) {
      throw new Error("Not connected");
    }
    this.cleanup();
    this._onPlayerLeave = onPlayerLeave;
    this._onPlayerJoin = onPlayerJoin;
    if (!playerConfig) {
      playerConfig = {};
    }
    playerConfig = { ...this.player.config, ...playerConfig };
    let room = this.rooms[roomId];
    if (!room) {
      try {
        await (() => {
          console.log("Room not found, waiting for room");
          return new Promise<void>((resolve, reject) => {
            let rejected = false;
            this.once("updateRoom", (playerId, room: Room) => {
              if (room.roomId === roomId && !rejected) {
                resolve();
              }
            });
            setTimeout(() => {
              rejected = true;
              reject("Timed out looking for room");
            }, this.options.roomTimeout ?? 5000);
          });
        })();
        room = this.rooms[roomId];
        if (!room) {
          throw new Error("Timed out looking for room");
        }
      } catch (e) {
        console.error("Failed to join room", e);
        throw e;
      }
    }
    this.subscribeFrame(roomId);

    return new Promise((resolve) => {
      this.roomSubs[roomId] = this.roomSubs[roomId] ?? [];
      this.roomSubs[roomId].push(
        this.once(
          "state",
          (
            playerId,
            stateJson: string,
            frameStack: {
              [playerId: number]: { keys: any; frame: number; events: string[] }[];
            }
            // timestamp: number
          ) => {
            if (playerId === this.player.netId) {
              return;
            }
            const roomState = this.roomStates[roomId];

            this.player.currentRoomId = roomId;
            const state: GameModelState = JSON.parse(stateJson);

            if (!this.listening) {
              this.touchListener?.replaceRegions(this.options.touchRegions ?? []);
            }
            if (!Object.keys(roomState.frameStack)) {
              roomState.frameStack = Object.entries(frameStack).reduce(
                (acc, [key, value]) => {
                  acc[+key] = value.map((frame) => {
                    return {
                      keys: this.inputManager.toKeyMap(frame.keys),
                      frame: frame.frame,
                      events: frame.events,
                      playerId: key,
                    };
                  });
                  return acc;
                },
                {} as {
                  [playerId: number]: { keys: KeyMap; frame: number; events: string[]; playerId: string }[];
                }
              );
            } else {
              Object.entries(frameStack).forEach(([playerId, frames]) => {
                const previousFrames = roomState.frameStack[playerId] ?? [];
                roomState.frameStack[playerId] = [];
                frames.forEach((frame) => {
                  roomState.frameStack[playerId].push({
                    keys: this.inputManager.toKeyMap(frame.keys),
                    frame: frame.frame,
                    events: frame.events,
                    playerId: playerId,
                  });
                });
                if (previousFrames.length) {
                  const lastFrame = roomState.frameStack[playerId][roomState.frameStack[playerId].length - 1].frame;
                  const firstFrame = roomState.frameStack[playerId][0].frame;

                  if (previousFrames[previousFrames.length - 1].frame < firstFrame) {
                    previousFrames.forEach((frame, i) => {
                      roomState.frameStack[playerId].unshift({
                        ...frame,
                      });
                    });
                  } else if (previousFrames[previousFrames.length - 1].frame > lastFrame) {
                    previousFrames.forEach((frame, i) => {
                      roomState.frameStack[playerId].push({
                        ...frame,
                      });
                    });
                  }
                }
              });
            }
            if (!roomState.gameModel || roomState.gameModel.destroyed) {
              roomState.gameModel = GameModel({
                seed,
                roomId,
                inputManager: gameInstance.options.connection.inputManager,
                playerEventManager: this.playerEventManager,
              }); // GameModel(GameCoordinator.GetInstance(), gameInstance, seed, coreOverrides);
              roomState.gameModel.deserializeState(state);
            }
            this.history[roomState.gameModel.roomId] = {
              frames: {},
              seed: roomState.gameModel.seed,
              startTimestamp: Date.now(),
              stateHashes: {},
              snapshots: {},
              configs: {},
            };
            if (roomState.gameModel) {
              // roomState.gameModel?.loadStateObject(state);
              roomState.gameModel.localNetIds = [this.player.netId];
            }
            if (roomState.frameStack[this.player.netId]) {
              this.listening = true;
            }
            resolve(roomState.gameModel);
          }
        )
      );
      this.emit("requestState", roomId, JSON.stringify(playerConfig));
      this.emit("joinRoom", roomId);
      this.setupStateRequest(this.player, roomId);
    });
  }

  async rejoin(roomId: string, localPlayerIndex?: number) {
    const roomState = this.roomStates[roomId];

    if (localPlayerIndex !== undefined) {
      this.createPlayer(
        roomState.gameModel,
        this.localPlayers[localPlayerIndex].netId,
        this.localPlayers[localPlayerIndex].config!,
        roomState.gameModel.frame
      );
      this.localPlayers[localPlayerIndex].currentRoomId = roomId;
      roomState.gameModel.localNetIds.push(this.localPlayers[localPlayerIndex].netId);
      roomState.gameModel.localNetIds = roomState.gameModel.localNetIds.sort();
    } else {
      for (let i = 0; i < this.localPlayers.length; ++i) {
        const player = this.localPlayers[i];
        this.createPlayer(roomState.gameModel, player.netId, player.config!, roomState.gameModel.frame);
        player.currentRoomId = roomId;
        roomState.gameModel.localNetIds.push(player.netId);
      }
      roomState.gameModel.localNetIds = roomState.gameModel.localNetIds.sort();
    }
  }

  async setupStateRequest(player: { netId: string }, roomId: string) {
    this.roomSubs[roomId] = this.roomSubs[roomId] ?? [];
    this.roomSubs[roomId].push(
      this.on("requestState", (playerId, _roomId, playerConfig) => {
        if (!this.stateRequested) {
          this.stateRequested = [];
        }
        this.stateRequested.push([playerId, JSON.parse(playerConfig || "{}")]);
      })
    );
  }

  async initialize(
    roomId: string,
    options: {
      gameInstance: GameInstance<T>;
      seed: string;
      coreOverrides?: { [key: string]: any };
      players: string[];
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void | Promise<void>;
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean | undefined;
    }
  ): Promise<GameModel> {
    if (!this.localPlayers.every((player) => player.connected)) {
      await this.connect();
    }

    this.cleanup();
    this._onPlayerJoin = options.onPlayerJoin;
    this._onPlayerLeave = options.onPlayerLeave;

    if (this.persistTimeouts[roomId]) {
      clearTimeout(this.persistTimeouts[roomId]);
      delete this.persistTimeouts[roomId];
      this.rejoin(roomId);
      return this.roomStates[roomId].gameModel;
    }

    const players = this.players
      .filter((player) => options.players.includes(player.netId))
      .sort((a, b) => a.netId.localeCompare(b.netId));
    const host = players[0];

    this.touchListener?.replaceRegions(this.options.touchRegions ?? []);
    for (let i = 0; i < this.localPlayers.length; ++i) {
      const player = this.localPlayers[i];
      player.currentRoomId = roomId;
      player.hostedRooms.push(roomId);
      this.setupStateRequest(player, roomId);
    }

    this.subscribeFrame(roomId);

    const roomState = this.roomStates[roomId];

    roomState.gameModel = GameModel(
      {
        seed: options.seed,
        roomId: roomId,
        inputManager: options.gameInstance.options.connection.inputManager,
        playerEventManager: this.playerEventManager,
      }
      // GameCoordinator.GetInstance(),
      // options.gameInstance,
      // options.seed,
      // options.coreOverrides
    );
    roomState.gameModel.paused = true;
    roomState.gameModel.localNetIds = this.localPlayers.map((player) => player.netId).sort();

    await this.buildWorld(roomState.gameModel, players[0].config, options.buildWorld);

    for (let i = 0; i < players.length; ++i) {
      const player = players[i];
      this.createPlayer(roomState.gameModel, player.netId, player.config!, roomState.gameModel.frame);
    }

    await this.firstFrame(roomState.gameModel, players[0].config);

    this.rooms[roomId] = {
      rebalanceOnLeave: options.rebalanceOnLeave ?? false,
      host: host.netId,
      players: players.map((player) => player.netId),
      roomId,
    };
    this.emit("joinRoom", roomId);
    return roomState.gameModel;
  }

  buildWorld(
    gameModel: GameModel,
    firstPlayerConfig: any,
    buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void | Promise<void>
  ): Promise<void> | void {
    this.history[gameModel.roomId] = {
      frames: {},
      seed: gameModel.seed,
      startTimestamp: Date.now(),
      stateHashes: {},
      snapshots: {},
      configs: {},
    };
    this.history[gameModel.roomId].configs[this.localPlayers[0].netId] = firstPlayerConfig;
    return buildWorld(gameModel, firstPlayerConfig);
  }

  firstFrame(gameModel: GameModel, _firstPlayerConfig: any): void | Promise<void> {
    const state = gameModel.serializeState();
    const serializedState = md5(JSON.stringify(state));

    this.history[gameModel.roomId].stateHashes[gameModel.frame] = serializedState;
    this.history[gameModel.roomId].snapshots[gameModel.frame] = state;

    return;
  }

  async host(
    roomId: string,
    {
      gameInstance,
      seed,
      coreOverrides,
      buildWorld,
      onPlayerJoin,
      onPlayerLeave,
      rebalanceOnLeave,
      playerConfig,
    }: {
      gameInstance: GameInstance<T>;
      seed: string;
      coreOverrides?: { [key: string]: any };
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void | Promise<void>;
      onPlayerJoin: (gameModel: GameModel, playerId: string) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean;
      playerConfig?: Partial<T>;
    }
  ): Promise<GameModel> {
    if (!this.localPlayers.every((player) => player.connected)) {
      await this.connect();
    }
    this.cleanup();
    this.touchListener?.replaceRegions(this.options.touchRegions ?? []);
    for (let i = 0; i < this.localPlayers.length; ++i) {
      const player = this.localPlayers[i];
      player.currentRoomId = roomId;
      player.hostedRooms.push(roomId);
      this.setupStateRequest(player, roomId);
    }

    this._onPlayerJoin = onPlayerJoin;
    this._onPlayerLeave = onPlayerLeave;
    this.subscribeFrame(roomId);

    const roomState = this.roomStates[roomId];

    roomState.gameModel = GameModel({
      seed,
      roomId,
      inputManager: gameInstance.options.connection.inputManager,
      playerEventManager: this.playerEventManager,
    }); //new GameModel(GameCoordinator.GetInstance(), gameInstance, seed, coreOverrides);

    const localPlayers = this.localPlayers.sort();

    const firstPlayerConfig = {
      ...localPlayers[0].config,
      ...playerConfig,
    };
    roomState.gameModel.localNetIds = localPlayers.map((player) => player.netId);

    await this.buildWorld(roomState.gameModel, firstPlayerConfig, buildWorld);

    for (let i = 0; i < localPlayers.length; ++i) {
      const player = localPlayers[i];
      this.createPlayer(
        roomState.gameModel,
        player.netId,
        {
          ...player.config!,
          ...playerConfig,
        },
        roomState.gameModel.frame
      );
    }

    await this.firstFrame(roomState.gameModel, firstPlayerConfig);

    this.updateRoom({
      rebalanceOnLeave: rebalanceOnLeave ?? false,
      host: localPlayers[0].netId,
      players: roomState.gameModel.localNetIds,
      roomId,
    });

    return roomState.gameModel;
  }

  protected createPlayer(gameModel: GameModel, playerId: string, playerConfig: T, frame: number) {
    if (this.history[gameModel.roomId]) {
      this.history[gameModel.roomId].configs[playerId] = playerConfig ?? ({} as any);
    }

    const entityId = this._onPlayerJoin(gameModel, playerId, playerConfig);

    gameModel.runGlobalMods(ComponentCategory.ON_JOIN, {
      joiningPlayer: entityId,
      playerId,
    });

    this.generateFrameStack(gameModel, playerId, frame);
    return entityId;
  }

  generateFrameStack = (gameModel: GameModel, playerId: string, frame: number) => {
    const initalFrameOffset = this.frameOffset;
    const roomState = this.roomStates[gameModel.roomId];

    roomState.frameStack[playerId] = new Array(initalFrameOffset).fill({ keys: {} as any, frame: 0 }).map((_, ind) => {
      return {
        frame: frame + ind,
        keys: InputManager.buildKeyMap(),
        events: [],
        playerId: playerId,
      };
    });
  };

  publishState(roomState: RoomState, netId: string, gameModel: GameModel) {
    const localPlayer = this.localPlayers.find((player) => player.netId === netId);

    if (
      localPlayer &&
      gameModel.frame + this.frameOffset > roomState.frameStack[netId][roomState.frameStack[netId].length - 1].frame
    ) {
      const currentKeyMap = this.inputManager.getKeyMap(localPlayer.inputType, localPlayer.inputIndex);
      const frame: Frame = {
        keys: this.inputManager.keyMapToJsonObject(currentKeyMap),
        frame: gameModel.frame + this.frameOffset,
        playerId: localPlayer.netId,
        events: this.playerEventManager.getEvents(localPlayer.netId),
      };
      this.emit("frame", frame);
    }
  }

  updateHistory(netId: string, frame: Frame, gameModel: GameModel) {
    this.history[gameModel.roomId].frames[netId] = this.history[gameModel.roomId].frames[netId] ?? [];
    this.history[gameModel.roomId].frames[netId].push({
      ...frame,
      keys: this.inputManager.keyMapToJsonObject(frame.keys as KeyMap),
    });

    if (gameModel.frame % 300 === 0) {
      localStorage.setItem("history", JSON.stringify(this.history));
    }
  }

  consumePlayerFrame(roomState: RoomState, netId: string, playerInput: PlayerInput, gameModel: GameModel) {
    if (roomState.frameStack[netId][0].frame === gameModel.frame) {
      const prevKeyMap = playerInput.keyMap;
      const frame = roomState.frameStack[netId].shift()!;
      const nextKeyMap = frame.keys as KeyMap;

      this.updateHistory(netId, frame, gameModel);

      playerInput.prevKeyMap = prevKeyMap;
      playerInput.keyMap = nextKeyMap;
      playerInput.events = frame.events;
    } else {
      console.log(roomState.frameStack[netId][0].frame, gameModel.frame);
      console.log(roomState.frameStack[netId]);
      throw new Error("Frame mismatch");
    }
  }

  startFrame(gameModel: GameModel) {
    if (this.frameSkipCheck(gameModel)) {
      return false;
    }
    const players = gameModel.getComponentActives("PlayerInput");
    const roomState = this.roomStates[gameModel.roomId];

    for (let i = 0; i < players.length; ++i) {
      const player = players[i];
      if (gameModel.hasComponent(PlayerInput, player)) {
        const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
        const netId = playerInput.pid;
        this.publishState(roomState, netId, gameModel);
        this.consumePlayerFrame(roomState, netId, playerInput, gameModel);
      }
    }
  }

  endFrame(gameModel: GameModel) {
    const roomState = this.roomStates[gameModel.roomId];

    if (this.stateRequested?.length) {
      const playerIds: string[] = [];
      while (this.stateRequested?.length) {
        const [playerId, playerConfig] = this.stateRequested.pop()!;
        playerIds.push(playerId);
        this.createPlayer(gameModel, playerId, playerConfig, gameModel.frame);
      }
      this.stateRequested = null;
      if (
        this.rooms[gameModel.roomId]?.players.sort().filter((pid) => !playerIds.includes(pid))[0] === this.player.netId
      ) {
        this.sendingState = true;

        const state = gameModel.serializeState();

        const frameStack = Object.entries(roomState.frameStack).reduce(
          (acc, [key, value]) => {
            acc[key] = value.map((frame) => {
              return {
                keys: this.inputManager.keyMapToJsonObject(frame.keys as KeyMap),
                frame: frame.frame,
              };
            });
            return acc;
          },
          {} as {
            [playerId: string]: { keys: any; frame: number }[];
          }
        );
        console.log("emitting state");
        this.emit("state", JSON.stringify(state), frameStack, +new Date());
      }
      // gameModel.loadStateObject(state);
    }

    // const state = gameModel.linearSerializeState();

    if (gameModel.frame % 300 === 0) {
      // const perf = performance.now();
      // const state = gameModel.serializeState();
      // const serializedState = md5(JSON.stringify(state));
      // this.history.stateHashes[gameModel.frame] = serializedState;
      // this.history.snapshots[gameModel.frame] = state;
      console.log(gameModel.frame); //, state, serializedState, performance.now() - perf);
    }
  }
}
