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
  ActivatePreloadedRoomOptions,
  RoomPreloadOptions,
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
import { BackgroundFrameFlow, type BackgroundFrameFlowOptions } from "./BackgroundFrameFlow";
import { HistoryPersistenceFlow, type HistoryPersistenceOptions } from "./HistoryPersistenceFlow";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export type CoreConnectionInstanceOptions<T> = {
  touchRegions?: TouchRegion[];
  roomTimeout?: number;
  roomPersist?: boolean | number;
  disconnectTimeoutMs?: number;
  backgroundFrameFlow?: BackgroundFrameFlowOptions | false;
  historyPersistence?: HistoryPersistenceOptions;
};

export class CoreConnectionInstance<T> implements ConnectionInstance<T> {
  instanceId = nanoid();

  stateRequested: null | [string, any][] = null;
  frameOffset = 8;
  disconnectingPlayers: [string, number][] = [];
  leavingPlayers: { [roomId: string]: [string, number][] } = {};
  pendingMissedFrames: { [roomId: string]: { [playerId: string]: number | undefined } } = {};
  missingFrameStalls: { [roomId: string]: { [playerId: string]: { frame: number; since: number } | undefined } } = {};
  publishedFrames: { [roomId: string]: { [playerId: string]: { [frame: number]: Frame } } } = {};
  historyPersistenceFlow: HistoryPersistenceFlow<T>;

  roomSyncResolve: () => void = () => {};
  roomSyncPromise: Promise<void> = new Promise((resolve) => {
    this.roomSyncResolve = () => {
      if (this.primaryLocalPlayer) {
        this.primaryLocalPlayer.roomsSynced = true;
      }
      resolve();
    };
  });

  inRoom: string = "";

  nickname: string = "";

  touchListener?: TouchListener | undefined;

  address: string = "";

  subscriptions: { [event: string]: ((playerId: string, ...args: any[]) => void)[] } = {};
  onceSubscriptions: { [event: string]: ((playerId: string, ...args: any[]) => void)[] } = {};

  messageListeners: ((message: string, time: number, playerId: string) => void)[] = [];
  connectListeners: ((player: PlayerConnect<T>) => void)[] = [];
  disconnectListeners: ((playerId: string) => void)[] = [];
  stepRequestedListeners: (() => void)[] = [];

  rooms: { [roomId: string]: Room } = {};
  roomStates: { [roomId: string]: RoomState } = {};
  preloadedRoomIds: Set<string> = new Set();

  players: PlayerConnection<T>[] = [];
  localPlayers: PlayerConnection<T>[] = [];

  history: {
    [roomId: string]: ReplayStack<T>;
  } = {};

  persistTimeouts: { [roomId: string]: ReturnType<typeof setTimeout> } = {};

  protected get primaryLocalPlayer(): PlayerConnection<T> {
    return this.localPlayers[0];
  }

  get player(): PlayerConnection<T> {
    if (this.localPlayers.length > 1) {
      throw new Error("Multiple local players");
    }
    return this.localPlayers[0];
  }

  roomSubs: { [roomId: string]: (() => void)[] } = {};

  playerEventManager: PlayerEventManager = new PlayerEventManager();
  backgroundFrameFlow: BackgroundFrameFlow;

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
    this.backgroundFrameFlow = new BackgroundFrameFlow(this, options.backgroundFrameFlow);
    this.historyPersistenceFlow = new HistoryPersistenceFlow(() => this.history, options.historyPersistence);

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
      if (playerId !== this.primaryLocalPlayer?.netId) {
        this.rooms = rooms;
        this.roomSyncResolve();
      }
    });
    this.on("connect", (playerId, player: PlayerConnect<T>) => {
      this.connectListeners.forEach((listener) => listener(player));
      if (player.netId !== this.primaryLocalPlayer?.netId && this.primaryLocalPlayer?.roomsSynced) {
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

      if (playerId === this.player.netId) {
        const gameModel = this.roomStates[roomId]!.gameModel;
        this.leavingPlayers[roomId] = this.leavingPlayers[roomId] ?? [];
        this.leavingPlayers[roomId].push([playerId, gameModel.frame]);
        this.handleLeavingPlayers(gameModel, this.roomStates[roomId]!.frameStack);
      } else {
        this.leavingPlayers[roomId] = this.leavingPlayers[roomId] ?? [];
        this.leavingPlayers[roomId].push([playerId, lastFrame]);
      }

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

    this.on("userDisconnect", (sourcePlayerId: string, targetPlayerIdOrFrame?: string | number, reportedDisconnectFrame?: number) => {
      const playerId = typeof targetPlayerIdOrFrame === "string" ? targetPlayerIdOrFrame : sourcePlayerId;
      const requestedDisconnectFrame =
        typeof targetPlayerIdOrFrame === "number" ? targetPlayerIdOrFrame : reportedDisconnectFrame;
      const player = this.players.find((player) => player.netId === playerId);
      const currentRoomId =
        player?.currentRoomId ??
        Object.keys(this.roomStates).find((roomId) => this.roomStates[roomId]?.frameStack[playerId]) ??
        "";
      if (!player) {
        if (!currentRoomId) {
          console.error("Something went horribly wrong, player not found", playerId, this.players);
          return;
        }
      } else {
        player.connected = false;
      }
      const wasDisconnecting = this.disconnectingPlayers.some(([disconnectingPlayerId]) => disconnectingPlayerId === playerId);
      this.players = this.players.filter((player) => player.netId !== playerId);
      this.localPlayers = this.localPlayers.filter((player) => player.netId !== playerId);
      if (!wasDisconnecting) {
        this.disconnectListeners.forEach((listener) => listener(playerId));
      }

      const roomState = this.roomStates[currentRoomId];
      const room = this.rooms[currentRoomId];
      if (room) {
        this.rooms[currentRoomId] = {
          ...room,
          players: room.players.filter((player) => player !== playerId),
        };
      }
      const localNetIds = roomState?.gameModel.localNetIds;
      const localId = localNetIds?.indexOf(playerId);
      if (localId !== undefined && localId !== -1) {
        localNetIds?.splice(localId, 1);
      }

      if (!roomState?.frameStack[playerId]) {
        return;
      }
      const frameStack = roomState.frameStack[playerId];
      const gameModel = roomState.gameModel;
      const knownDisconnectFrame = Math.floor((roomState.lastFrame[playerId] ?? gameModel.frame) / 10) * 10 + 10;
      const disconnectFrame = Math.max(
        knownDisconnectFrame,
        Number.isFinite(requestedDisconnectFrame) ? requestedDisconnectFrame! : knownDisconnectFrame
      );

      let startingFrame;
      if (frameStack.length === 0) {
        startingFrame = gameModel.frame;
      } else {
        startingFrame = (roomState.lastFrame[playerId] ?? gameModel.frame) + 1;
      }
      for (let i = startingFrame; i < disconnectFrame; i += 1) {
        frameStack.push({
          keys: InputManager.buildKeyMap(),
          frame: i,
          events: [],
          playerId: playerId,
          roomId: currentRoomId,
        });
      }
      roomState.lastFrame[playerId] = Math.max(roomState.lastFrame[playerId] ?? -1, disconnectFrame - 1);

      const disconnectingIndex = this.disconnectingPlayers.findIndex(
        ([disconnectingPlayerId]) => disconnectingPlayerId === playerId
      );
      let disconnectFrameChanged = false;
      if (disconnectingIndex !== -1 && this.disconnectingPlayers[disconnectingIndex][1] < disconnectFrame) {
        this.disconnectingPlayers[disconnectingIndex][1] = disconnectFrame;
        disconnectFrameChanged = true;
      } else if (disconnectingIndex === -1) {
        this.disconnectingPlayers.push([playerId, disconnectFrame]);
        disconnectFrameChanged = true;
      }

      this.leavingPlayers[currentRoomId] = this.leavingPlayers[currentRoomId] ?? [];
      const leavingIndex = this.leavingPlayers[currentRoomId].findIndex(([leavingPlayerId]) => leavingPlayerId === playerId);
      if (leavingIndex !== -1 && this.leavingPlayers[currentRoomId][leavingIndex][1] < disconnectFrame) {
        this.leavingPlayers[currentRoomId][leavingIndex][1] = disconnectFrame;
      } else if (leavingIndex === -1) {
        this.leavingPlayers[currentRoomId].push([playerId, disconnectFrame]);
      }

      if (disconnectFrameChanged) {
        this.emit("userDisconnect", playerId, disconnectFrame);
      }
    });

    this.on("updatePlayerConnect", (playerId: string, player: PlayerConnection<T>) => {
      console.log("updatePlayerConnect", "CONNECT CHANGE", this.connectListeners.length);
      this.players = this.players.map((p) => (p.netId === player.netId ? player : p));
      this.connectListeners.forEach((listener) => listener(player));
    });

    this.on("missedFrame", (_playerId, roomId: string, targetPlayerId: string, frameNumber: number) => {
      if (targetPlayerId !== this.player.netId) {
        return;
      }
      const frame = this.publishedFrames[roomId]?.[targetPlayerId]?.[frameNumber];
      if (!frame) {
        return;
      }
      this.emit("frame", {
        keys: this.inputManager.keyMapToJsonObject(frame.keys as KeyMap),
        frame: frame.frame,
        events: frame.events,
        playerId: frame.playerId,
      });
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
    this.touchListener?.replaceRegions([]);
    const gameModel = this.roomStates[roomId]!.gameModel;
    if (lastFrame < gameModel.frame + this.frameOffset) {
      lastFrame = gameModel.frame + this.frameOffset;
    }
    if (localPlayerIndex !== undefined) {
      const player = this.localPlayers[localPlayerIndex];
      if (player.currentRoomId === roomId) {
        this.emit("leaveRoom", player.currentRoomId, lastFrame);
        player.currentRoomId = null;
      }
      return;
    }

    for (let i = 0; i < this.localPlayers.length; ++i) {
      const player = this.localPlayers[i];
      if (player.currentRoomId === roomId) {
        this.emit("leaveRoom", player.currentRoomId, lastFrame);
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
  onStepRequested(cb: () => void): () => void {
    this.stepRequestedListeners.push(cb);
    return () => {
      this.stepRequestedListeners = this.stepRequestedListeners.filter((listener) => listener !== cb);
    };
  }

  requestStep(): boolean {
    this.stepRequestedListeners.forEach((listener) => listener());
    return true;
  }

  handleLeavingPlayers(gameModel: GameModel, frameStack: { [playerId: string]: Frame[] }) {
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
  }

  private clearMissingFrameStall(roomId: string, playerId: string): void {
    if (this.missingFrameStalls[roomId]) {
      delete this.missingFrameStalls[roomId][playerId];
    }
  }

  private recordMissingFrameStall(
    gameModel: GameModel,
    playerId: string
  ): { firstMiss: boolean; timedOut: boolean } {
    this.missingFrameStalls[gameModel.roomId] = this.missingFrameStalls[gameModel.roomId] ?? {};
    const roomStalls = this.missingFrameStalls[gameModel.roomId];
    const current = roomStalls[playerId];
    const now = Date.now();
    const firstMiss = !current || current.frame !== gameModel.frame;
    if (firstMiss) {
      roomStalls[playerId] = { frame: gameModel.frame, since: now };
      return { firstMiss: true, timedOut: false };
    }
    return {
      firstMiss: false,
      timedOut: now - current.since >= (this.options.disconnectTimeoutMs ?? 3000),
    };
  }

  private isRemotePlayer(playerId: string): boolean {
    return !this.localPlayers.some((player) => player.netId === playerId);
  }

  private maybeDisconnectStalledPlayer(gameModel: GameModel, playerId: string): boolean {
    const stall = this.recordMissingFrameStall(gameModel, playerId);
    if (stall.firstMiss) {
      console.error("dropping slow frame", playerId, gameModel.frame);
    }
    if (!stall.timedOut || !this.isRemotePlayer(playerId)) {
      return false;
    }
    console.warn("disconnecting stalled player", playerId, gameModel.frame);
    this.clearMissingFrameStall(gameModel.roomId, playerId);
    this.emit("userDisconnect", playerId);
    return true;
  }

  frameSkipCheck = (gameModel: GameModel): boolean => {
    const room = this.roomStates[gameModel.roomId];
    const frameStack = room?.frameStack;
    const isStepMode = gameModel.executionMode === "step";

    this.handleLeavingPlayers(gameModel, frameStack);

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
          if (!isStepMode) {
            console.error("old frame received:" + netId);
          }
          frameStack[netId].shift();
        }

        if (!frameStack[netId] || !frameStack[netId][0]) {
          if (isStepMode) {
            continue;
          }
          if (this.maybeDisconnectStalledPlayer(gameModel, netId)) {
            continue;
          }
          return true;
        }

        if (frameStack[netId][0].frame > gameModel.frame) {
          if (isStepMode) {
            continue;
          }
          if (this.maybeDisconnectStalledPlayer(gameModel, netId)) {
            continue;
          }
          this.pendingMissedFrames[gameModel.roomId] = this.pendingMissedFrames[gameModel.roomId] ?? {};
          if (this.pendingMissedFrames[gameModel.roomId][netId] !== gameModel.frame) {
            this.pendingMissedFrames[gameModel.roomId][netId] = gameModel.frame;
            this.emit("missedFrame", gameModel.roomId, netId, gameModel.frame);
          }
          return true;
        }
        this.clearMissingFrameStall(gameModel.roomId, netId);
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
      this.preloadedRoomIds.delete(roomId);
      delete this.pendingMissedFrames[roomId];
      delete this.publishedFrames[roomId];
      this.backgroundFrameFlow.clearRoom(roomId);
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
    this.roomSubs[roomId].push(
      this.on("frame", (_playerId, frame) => {
        this.backgroundFrameFlow.enqueueFrame(roomId, frame);
      })
    );
    this.roomSubs[roomId].push(
      this.on("frameBatch", (_playerId, batch) => {
        this.backgroundFrameFlow.enqueueFrameBatch(roomId, batch);
      })
    );
  }

  private serializeFrameStack(roomState: RoomState): {
    [playerId: string]: { keys: any; frame: number; events: string[] }[];
  } {
    return Object.entries(roomState.frameStack).reduce(
      (acc, [key, value]) => {
        acc[key] = value.map((frame) => ({
          keys: this.inputManager.keyMapToJsonObject(frame.keys as KeyMap),
          frame: frame.frame,
          events: frame.events,
          roomId: frame.roomId,
        }));
        return acc;
      },
      {} as { [playerId: string]: { keys: any; frame: number; events: string[] }[] }
    );
  }

  private mergeSerializedFrameStack(
    roomState: RoomState,
    frameStack: { [playerId: string]: { keys: any; frame: number; events?: string[] }[] }
  ): void {
    Object.entries(frameStack).forEach(([playerId, frames]) => {
      const previousFrames = roomState.frameStack[playerId] ?? [];
      roomState.frameStack[playerId] = [];
      frames.forEach((frame) => {
        roomState.frameStack[playerId].push({
          keys: this.inputManager.toKeyMap(frame.keys),
          frame: frame.frame,
          events: frame.events ?? [],
          playerId,
          roomId: roomState.gameModel.roomId,
        });
      });
      if (previousFrames.length && roomState.frameStack[playerId].length) {
        const lastFrame = roomState.frameStack[playerId][roomState.frameStack[playerId].length - 1].frame;
        const firstFrame = roomState.frameStack[playerId][0].frame;

        if (previousFrames[previousFrames.length - 1].frame < firstFrame) {
          previousFrames.forEach((frame) => roomState.frameStack[playerId].unshift({ ...frame }));
        } else if (previousFrames[previousFrames.length - 1].frame > lastFrame) {
          previousFrames.forEach((frame) => roomState.frameStack[playerId].push({ ...frame }));
        }
      } else if (previousFrames.length && roomState.frameStack[playerId].length === 0) {
        roomState.frameStack[playerId] = previousFrames;
      }
      roomState.lastFrame[playerId] = Math.max(
        roomState.lastFrame[playerId] ?? -1,
        ...roomState.frameStack[playerId].map((frame) => frame.frame)
      );
    });
  }

  private findPlayerEntity(gameModel: GameModel, playerId: string): number | undefined {
    return gameModel.getComponentActives("PlayerInput").find((entity) => {
      if (!gameModel.hasComponent(PlayerInput, entity)) return false;
      return gameModel.getTypedUnsafe(PlayerInput, entity).pid === playerId;
    });
  }

  private async createPreloadedGameModel(
    roomId: string,
    options: RoomPreloadOptions<T>,
    firstPlayerConfig: any
  ): Promise<GameModel> {
    this.subscribeFrame(roomId);
    const roomState = this.roomStates[roomId];
    roomState.gameModel = GameModel({
      seed: options.seed,
      roomId,
      inputManager: options.gameInstance.options.connection.inputManager,
      playerEventManager: this.playerEventManager,
    });
    roomState.gameModel.paused = true;
    roomState.gameModel.preloadOnly = true;
    roomState.gameModel.localNetIds = [];

    await this.buildWorld(roomState.gameModel, firstPlayerConfig, options.buildWorld);
    await this.firstFrame(roomState.gameModel, firstPlayerConfig);

    this.rooms[roomId] = {
      rebalanceOnLeave: options.rebalanceOnLeave ?? false,
      host: "",
      players: [],
      roomId,
    };
    return roomState.gameModel;
  }

  async preloadRoom(roomId: string, options: RoomPreloadOptions<T>): Promise<GameModel> {
    if (!this.localPlayers.every((player) => player.connected)) {
      await this.connect();
    }
    this._onPlayerJoin = options.onPlayerJoin;
    this._onPlayerLeave = options.onPlayerLeave;

    const existing = this.roomStates[roomId]?.gameModel;
    if (existing && !existing.destroyed) {
      existing.preloadOnly = existing.localNetIds.length === 0;
      if (existing.preloadOnly) this.preloadedRoomIds.add(roomId);
      return existing;
    }

    await this.roomSyncPromise;
    const knownRoom = this.rooms[roomId];
    if (!knownRoom?.players.length) {
      const gameModel = await this.createPreloadedGameModel(roomId, options, this.localPlayers[0]?.config ?? {});
      this.preloadedRoomIds.add(roomId);
      return gameModel;
    }

    this.subscribeFrame(roomId);
    this.preloadedRoomIds.add(roomId);
    const requestId = nanoid();
    return new Promise<GameModel>((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out preloading room ${roomId}`));
      }, this.options.roomTimeout ?? 5000);
      const unsubscribe = this.on(
        "preloadState",
        async (
          _hostPlayerId,
          targetPlayerId: string,
          responseRequestId: string,
          stateRoomId: string,
          stateJson: string,
          frameStack: { [playerId: string]: { keys: any; frame: number; events?: string[] }[] }
        ) => {
          if (targetPlayerId !== this.player.netId || responseRequestId !== requestId || stateRoomId !== roomId) {
            return;
          }
          clearTimeout(timeout);
          unsubscribe();
          const roomState = this.roomStates[roomId];
          this.mergeSerializedFrameStack(roomState, frameStack ?? {});
          const state: GameModelState = JSON.parse(stateJson);
          if (!roomState.gameModel || roomState.gameModel.destroyed) {
            roomState.gameModel = GameModel({
              seed: options.seed,
              roomId,
              inputManager: options.gameInstance.options.connection.inputManager,
              playerEventManager: this.playerEventManager,
            });
            await roomState.gameModel.deserializeState(state);
          }
          roomState.gameModel.preloadOnly = true;
          roomState.gameModel.localNetIds = [];
          this.preloadedRoomIds.add(roomId);
          this.resetHistory(roomState.gameModel.roomId, {
            frames: {},
            seed: roomState.gameModel.seed,
            startTimestamp: Date.now(),
            stateHashes: {},
            snapshots: {},
            configs: {},
          });
          resolve(roomState.gameModel);
        }
      );
      this.emit("requestPreloadState", roomId, requestId);
    });
  }

  async activatePreloadedRoom(
    roomId: string,
    options: ActivatePreloadedRoomOptions<T>
  ): Promise<GameModel> {
    if (!this.localPlayers.every((player) => player.connected)) {
      await this.connect();
    }
    this._onPlayerJoin = options.onPlayerJoin;
    this._onPlayerLeave = options.onPlayerLeave;
    const localPlayerIndex = options.localPlayerIndex ?? 0;
    const player = this.localPlayers[localPlayerIndex];
    if (!player) throw new Error(`No local player at index ${localPlayerIndex}.`);

    const room = this.rooms[roomId];
    const roomState = this.roomStates[roomId];
    const gameModel = roomState?.gameModel;
    if ((!gameModel || gameModel.destroyed) && room?.players.length && !room.players.includes(player.netId)) {
      return this.join(roomId, {
        gameInstance: options.gameInstance,
        seed: options.seed,
        coreOverrides: options.coreOverrides,
        onPlayerJoin: options.onPlayerJoin,
        onPlayerLeave: options.onPlayerLeave,
        playerConfig: options.playerConfig,
      });
    }

    if (!gameModel || gameModel.destroyed) {
      throw new Error(`Cannot activate room ${roomId}; it has not been preloaded.`);
    }
    const needsRemoteJoinState = !!room?.players.length && !room.players.includes(player.netId);
    if (player.currentRoomId && player.currentRoomId !== roomId) {
      const currentRoomState = this.roomStates[player.currentRoomId];
      this.leaveRoom(player.currentRoomId, currentRoomState?.gameModel?.frame ?? gameModel.frame, localPlayerIndex);
    }
    this.setupStateRequest(player, roomId);
    gameModel.preloadOnly = false;
    gameModel.paused = false;
    let entity = this.findPlayerEntity(gameModel, player.netId);
    if (entity == null) {
      if (options.deferPlayerEntity) {
        this.generateFrameStack(gameModel, player.netId, gameModel.frame);
      } else {
        entity = this.createPlayer(gameModel, player.netId, { ...player.config, ...options.playerConfig } as T, gameModel.frame);
      }
    } else {
      this.generateFrameStack(gameModel, player.netId, gameModel.frame);
    }
    player.currentRoomId = roomId;
    if (!player.hostedRooms.includes(roomId)) player.hostedRooms.push(roomId);
    if (!gameModel.localNetIds.includes(player.netId)) {
      gameModel.localNetIds.push(player.netId);
      gameModel.localNetIds = gameModel.localNetIds.sort();
    }
    this.preloadedRoomIds.delete(roomId);
    this.rooms[roomId] = {
      rebalanceOnLeave: room?.rebalanceOnLeave ?? false,
      host: room?.host || player.netId,
      players: room?.players.includes(player.netId) ? room.players : [...(room?.players ?? []), player.netId],
      roomId,
    };
    if (needsRemoteJoinState) {
      this.emit("requestState", roomId, JSON.stringify({ ...player.config, ...options.playerConfig }));
    }
    this.emit("joinRoom", roomId);
    return gameModel;
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
          async (
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

            if (!Object.keys(roomState.frameStack)) {
              roomState.frameStack = Object.entries(frameStack).reduce(
                (acc, [key, value]) => {
                  acc[+key] = value.map((frame) => {
                    return {
                      keys: this.inputManager.toKeyMap(frame.keys),
                      frame: frame.frame,
                      events: frame.events,
                      playerId: key,
                      roomId,
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
                    roomId,
                  });
                });
                if (previousFrames.length && roomState.frameStack[playerId].length) {
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
                } else if (previousFrames.length && roomState.frameStack[playerId].length === 0) {
                  roomState.frameStack[playerId] = previousFrames;
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
              await roomState.gameModel.deserializeState(state);
            }
            this.resetHistory(roomState.gameModel.roomId, {
              frames: {},
              seed: roomState.gameModel.seed,
              startTimestamp: Date.now(),
              stateHashes: {},
              snapshots: {},
              configs: {},
            });
            if (roomState.gameModel) {
              // roomState.gameModel?.loadStateObject(state);
              roomState.gameModel.preloadOnly = false;
              roomState.gameModel.localNetIds = [this.player.netId];
              roomState.gameModel.stepDraw();
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
      roomState.gameModel.preloadOnly = false;
      roomState.gameModel.localNetIds.push(this.localPlayers[localPlayerIndex].netId);
      roomState.gameModel.localNetIds = roomState.gameModel.localNetIds.sort();
    } else {
      for (let i = 0; i < this.localPlayers.length; ++i) {
        const player = this.localPlayers[i];
        this.createPlayer(roomState.gameModel, player.netId, player.config!, roomState.gameModel.frame);
        player.currentRoomId = roomId;
        roomState.gameModel.preloadOnly = false;
        roomState.gameModel.localNetIds.push(player.netId);
      }
      roomState.gameModel.localNetIds = roomState.gameModel.localNetIds.sort();
    }
  }

  async setupStateRequest(player: { netId: string }, roomId: string) {
    this.roomSubs[roomId] = this.roomSubs[roomId] ?? [];
    this.roomSubs[roomId].push(
      this.on("requestState", (playerId, _roomId, playerConfig) => {
        if (_roomId !== roomId) {
          return;
        }
        if (!this.stateRequested) {
          this.stateRequested = [];
        }
        this.stateRequested.push([playerId, JSON.parse(playerConfig || "{}")]);
        if (this.roomStates[roomId]?.gameModel?.executionMode === "step") {
          this.requestStep();
        }
      })
    );
    this.roomSubs[roomId].push(
      this.on("requestPreloadState", (playerId, _roomId, requestId) => {
        if (_roomId !== roomId || playerId === this.player.netId) {
          return;
        }
        const roomState = this.roomStates[roomId];
        const gameModel = roomState?.gameModel;
        if (!gameModel || gameModel.destroyed) {
          return;
        }
        this.emit(
          "preloadState",
          playerId,
          requestId,
          roomId,
          JSON.stringify(gameModel.serializeState()),
          this.serializeFrameStack(roomState)
        );
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
    roomState.gameModel.preloadOnly = false;
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
    this.resetHistory(gameModel.roomId, {
      frames: {},
      seed: gameModel.seed,
      startTimestamp: Date.now(),
      stateHashes: {},
      snapshots: {},
      configs: {},
    });
    this.history[gameModel.roomId].configs[this.localPlayers[0].netId] = firstPlayerConfig;
    this.historyPersistenceFlow.setPlayerConfig(gameModel.roomId, this.localPlayers[0].netId, firstPlayerConfig);
    return buildWorld(gameModel, firstPlayerConfig);
  }

  private resetHistory(roomId: string, stack: ReplayStack<T>): void {
    this.history[roomId] = stack;
    this.historyPersistenceFlow.resetRoom(roomId, stack);
  }

  firstFrame(gameModel: GameModel, _firstPlayerConfig: any): void | Promise<void> {
    const state = gameModel.serializeState();
    const serializedState = md5(JSON.stringify(state));

    this.history[gameModel.roomId].stateHashes[gameModel.frame] = serializedState;
    this.history[gameModel.roomId].snapshots[gameModel.frame] = state;
    this.historyPersistenceFlow.recordSnapshot(gameModel.roomId, gameModel.frame, serializedState, state);

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
    roomState.gameModel.preloadOnly = false;

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
      this.historyPersistenceFlow.setPlayerConfig(gameModel.roomId, playerId, playerConfig ?? ({} as any));
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
        roomId: gameModel.roomId,
      };
    });
    roomState.lastFrame[playerId] = frame + initalFrameOffset - 1;
  };

  publishState(roomState: RoomState, netId: string, gameModel: GameModel) {
    const localPlayer = this.localPlayers.find((player) => player.netId === netId);
    const targetFrame = gameModel.executionMode === "step" ? gameModel.frame : gameModel.frame + this.frameOffset;

    if (localPlayer) {
      const backgroundFrame = this.backgroundFrameFlow.localFrameOverride(localPlayer);
      const currentKeyMap = backgroundFrame?.keys ?? this.inputManager.getKeyMap(localPlayer.inputType, localPlayer.inputIndex);
      const frame: Frame = {
        keys: this.inputManager.keyMapToJsonObject(currentKeyMap),
        frame: targetFrame,
        playerId: localPlayer.netId,
        roomId: gameModel.roomId,
        events: backgroundFrame?.events ?? this.playerEventManager.getEvents(localPlayer.netId),
      };
      roomState.frameStack[netId] = roomState.frameStack[netId] ?? [];
      if (gameModel.executionMode !== "step") {
        const lastQueuedFrame = roomState.frameStack[netId][roomState.frameStack[netId].length - 1]?.frame ?? -Infinity;
        if (targetFrame <= lastQueuedFrame) {
          return;
        }
        roomState.frameStack[netId].push({
          keys: currentKeyMap,
          frame: targetFrame,
          events: frame.events,
          playerId: localPlayer.netId,
          roomId: gameModel.roomId,
        });
      } else {
        const existingIndex = roomState.frameStack[netId].findIndex((queuedFrame) => queuedFrame.frame === targetFrame);
        if (existingIndex !== -1) {
          roomState.frameStack[netId][existingIndex] = {
            keys: currentKeyMap,
            frame: targetFrame,
            events: frame.events,
            playerId: localPlayer.netId,
            roomId: gameModel.roomId,
          };
        } else {
          roomState.frameStack[netId].push({
            keys: currentKeyMap,
            frame: targetFrame,
            events: frame.events,
            playerId: localPlayer.netId,
            roomId: gameModel.roomId,
          });
          roomState.frameStack[netId].sort((a, b) => a.frame - b.frame);
        }
      }
      roomState.lastFrame[netId] = Math.max(roomState.lastFrame[netId] ?? -1, targetFrame);
      this.publishedFrames[gameModel.roomId] = this.publishedFrames[gameModel.roomId] ?? {};
      this.publishedFrames[gameModel.roomId][localPlayer.netId] = this.publishedFrames[gameModel.roomId][localPlayer.netId] ?? {};
      this.publishedFrames[gameModel.roomId][localPlayer.netId][frame.frame] = frame;
      const pruneBeforeFrame = Math.max(0, gameModel.frame - Math.max(this.frameOffset * 4, 32));
      Object.keys(this.publishedFrames[gameModel.roomId][localPlayer.netId]).forEach((publishedFrame) => {
        if (+publishedFrame < pruneBeforeFrame) {
          delete this.publishedFrames[gameModel.roomId][localPlayer.netId][+publishedFrame];
        }
      });
      this.emit("frame", frame);
    }
  }

  updateHistory(netId: string, frame: Frame, gameModel: GameModel) {
    this.history[gameModel.roomId].frames[netId] = this.history[gameModel.roomId].frames[netId] ?? [];
    const historyFrame = {
      ...frame,
      keys: this.inputManager.keyMapToJsonObject(frame.keys as KeyMap),
    };
    this.history[gameModel.roomId].frames[netId].push(historyFrame);
    this.historyPersistenceFlow.recordFrame(gameModel.roomId, netId, historyFrame);
    this.historyPersistenceFlow.persistIfDue(gameModel.frame);
  }

  consumePlayerFrame(roomState: RoomState, netId: string, playerInput: PlayerInput, gameModel: GameModel) {
    while ((roomState.frameStack[netId]?.[0]?.frame ?? Infinity) < gameModel.frame) {
      roomState.frameStack[netId].shift();
    }

    if (gameModel.executionMode === "step" && roomState.frameStack[netId]?.[0]?.frame !== gameModel.frame) {
      playerInput.prevKeyMap = playerInput.keyMap;
      playerInput.events = [];
      return;
    }

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
    const players = gameModel.getComponentActives("PlayerInput");
    const roomState = this.roomStates[gameModel.roomId];

    if (gameModel.executionMode === "step") {
      for (let i = 0; i < players.length; ++i) {
        const player = players[i];
        if (gameModel.hasComponent(PlayerInput, player)) {
          const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
          this.publishState(roomState, playerInput.pid, gameModel);
        }
      }
    }

    if (this.frameSkipCheck(gameModel)) {
      return false;
    }

    for (let i = 0; i < players.length; ++i) {
      const player = players[i];
      if (gameModel.hasComponent(PlayerInput, player)) {
        const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
        const netId = playerInput.pid;
        if (gameModel.executionMode !== "step") {
          this.publishState(roomState, netId, gameModel);
        }
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
