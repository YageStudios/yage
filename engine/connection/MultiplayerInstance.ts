import { PhysicsSystem } from "@/components/physics/Physics";
import { GameModel } from "@/game/GameModel";
import { InputManager, KeyMap } from "@/inputs/InputManager";
import { ConnectionInstance, PlayerConnect, PlayerConnection } from "./ConnectionInstance";
import { md5 } from "@/utils/md5";
import { nanoid } from "nanoid";
import { RequireAtLeastOne } from "@/utils/typehelpers";
import { MouseManager } from "@/inputs/MouseManager";
import { TouchListener } from "@/inputs/TouchListener";
import { PlayerEventManager } from "@/inputs/PlayerEventManager";
import { ChildSchema } from "@/schemas/entity/Child";
import { GameInstance } from "@/game/GameInstance";
import { GameCoordinator } from "@/game/GameCoordinator";
import { PlayerInputSchema } from "@/schemas/core/PlayerInput";
import { TouchRegion } from "@/inputs/InputRegion";

export type Frame = { keys: KeyMap | { [key: string]: boolean }; frame: number; events: string[]; playerId: string };

type FrameStack = { [playerId: string]: Frame[] };

type Room = {
  roomId: string;
  host: string;
  players: string[];
  rebalanceOnLeave: boolean;
};

type RoomState = {
  gameModel: GameModel;
  frameStack: FrameStack;
  lastFrame: { [playerId: string]: number };
};

export type MultiplayerInstanceOptions<T> = {
  solohost?: boolean;
  touchRegions?: TouchRegion[];
  roomTimeout?: number;
  prefix: string;
  address?: string;
  host?: string;
};

export class MultiplayerInstance<T> implements ConnectionInstance<T> {
  instanceId = nanoid();

  stateRequested: null | [string, any][] = null;
  frameOffset = 5;
  sendingState = false;
  leavingPlayers: [string, number][] = [];

  inRoom: string = "";

  playerId: string = nanoid();
  nickname: string = "";
  listening: boolean;

  touchListener?: TouchListener | undefined;

  address: string = "";

  subscriptions: { [event: string]: ((...args: any[]) => void)[] } = {};
  onceSubscriptions: { [event: string]: ((...args: any[]) => void)[] } = {};

  messageListeners: ((message: string, time: number, playerId: string) => void)[] = [];
  connectListeners: ((player: PlayerConnect<T>) => void)[] = [];
  disconnectListeners: ((playerId: string) => void)[] = [];

  rooms: { [roomId: string]: Room } = {};
  roomStates: { [roomId: string]: RoomState } = {};

  players: PlayerConnection<T>[] = [];
  player: PlayerConnection<T>;

  roomSubs: { [roomId: string]: (() => void)[] } = {};
  solohost: boolean;

  eventsManager: PlayerEventManager = new PlayerEventManager();

  constructor(
    player: PlayerConnect<T>,
    public inputManager: InputManager,
    public mouseManager: MouseManager,
    protected options: MultiplayerInstanceOptions<T>
  ) {
    options.solohost = options.solohost ?? false;
    this.solohost = options.solohost ?? false;
    if (options.touchRegions) {
      this.touchListener = new TouchListener(this.inputManager);
    }
    this.player = {
      ...player,
      connected: false,
      connectionTime: 0,
      currentRoomId: null,
      hostedRooms: [],
    };
    this.players.push(this.player);
    this.playerId = player.id;

    this.on("message", (message: string, time: number, playerId: string) => {
      this.messageListeners.forEach((listener) => listener(message, time, playerId));
    });
    this.on("updateRoom", (room: Room) => {
      if (room.players.length === 0) {
        delete this.rooms[room.roomId];
        delete this.roomStates[room.roomId];
        this.roomSubs[room.roomId]?.forEach((sub) => sub());
        delete this.roomSubs[room.roomId];
      } else {
        this.rooms[room.roomId] = room;
      }
    });
    this.on("rooms", (rooms: { [roomId: string]: Room }) => {
      this.rooms = rooms;
    });
    this.on("connect", (player: PlayerConnect<T>) => {
      this.connectListeners.forEach((listener) => listener(player));

      if (Object.keys(this.rooms).length) {
        this.emit("rooms", this.rooms);
      }
    });
    this.on("leaveRoom", (playerId: string, roomId: string) => {
      this.rooms[roomId] = {
        ...this.rooms[roomId],
        players: this.rooms[roomId].players.filter((player) => player !== playerId),
      };
      if (this.rooms[roomId].players.length === 0) {
        delete this.rooms[roomId];
        delete this.roomStates[roomId];
        this.roomSubs[roomId]?.forEach((sub) => sub());
        delete this.roomSubs[roomId];
      }
    });

    this.on("joinRoom", (playerId: string, roomId: string) => {
      this.rooms[roomId] = {
        ...this.rooms[roomId],
        players: [...this.rooms[roomId].players, playerId],
      };
    });

    this.on("userDisconnect", (playerId: string, lastFrame: number) => {
      this.players = this.players.filter((player) => player.id !== playerId);
      this.disconnectListeners.forEach((listener) => listener(playerId));

      const currentRoomId = this.player.currentRoomId ?? "";

      if (!this.roomStates[currentRoomId]?.frameStack[playerId]) {
        return;
      }
      if (!lastFrame) {
        const room = this.rooms[currentRoomId];
        if (room) {
          this.emit("leaveRoom", playerId, currentRoomId);
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
          keys: this.inputManager.buildKeyMap(),
          frame: i,
          events: [],
          playerId: playerId,
        });
      }

      const leavingIndex = this.leavingPlayers.findIndex(([playerId]) => playerId === playerId);
      if (leavingIndex !== -1 && this.leavingPlayers[leavingIndex][1] < lastFrame) {
        this.leavingPlayers[leavingIndex][1] = lastFrame;
      } else if (leavingIndex === -1) {
        this.leavingPlayers.push([playerId, lastFrame]);
        this.emit("userDisconnect", playerId, lastFrame);
      }
    });

    this.on("updatePlayerConnect", (player: PlayerConnection<T>) => {
      console.log("updatePlayerConnect", "CONNECT CHANGE", this.connectListeners.length);
      this.players = this.players.map((p) => (p.id === player.id ? player : p));
      this.connectListeners.forEach((listener) => listener(player));
    });
  }

  hasRoom(roomId: string): boolean {
    return !!this.rooms[roomId]?.players.length;
  }

  updatePlayerConnect(
    player: RequireAtLeastOne<{ name: string; token: string; config: T }, "name" | "token" | "config">
  ): void {
    this.player.name = player.name ?? this.player.name;
    this.player.token = player.token ?? this.player.token;
    this.player.config = player.config ?? this.player.config;

    this.emit("updatePlayerConnect", this.player);
  }

  leaveRoom() {
    this.listening = false;
    this.sendingState = false;
    this.touchListener?.replaceRegions([]);
    this.emit("leaveRoom", this.playerId, this.player.currentRoomId);
    this.player.currentRoomId = null;
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

  changeNickname(nickname: string): void {
    this.emit("changeNickname", this.playerId, nickname);
  }

  sendMessage(message: string, includeSelf = true): void {
    this.emit("message", message, +new Date(), this.playerId);
    if (includeSelf) {
      this.messageListeners.forEach((listener) => listener(message, +new Date(), this.playerId));
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

    if (this.leavingPlayers.length) {
      for (let i = 0; i < this.leavingPlayers.length; ++i) {
        if (this.leavingPlayers[i][1] === gameModel.frame) {
          console.log("removing player", this.leavingPlayers[i][0], gameModel.frame);
          this._onPlayerLeave(gameModel, this.leavingPlayers[i][0]);
          delete frameStack[this.leavingPlayers[i][0]];
          this.leavingPlayers.splice(i, 1);
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
      let player = players[i];
      if (gameModel.hasComponent(player, PlayerInputSchema)) {
        const PlayerInput = gameModel.getTyped(player, PlayerInputSchema);
        const netId = PlayerInput.id;
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

  emit(event: string, ...args: any[]) {}

  cleanup() {
    let roomId = this.player.currentRoomId;
    if (!roomId) {
      return;
    }
    this.roomSubs[roomId]?.forEach((sub) => sub());
    delete this.roomSubs[roomId];
    delete this.roomStates[roomId];
    delete this.rooms[roomId];
  }

  on(event: string, callback: (...args: any[]) => void) {
    if (!this.subscriptions[event]) {
      this.subscriptions[event] = [];
    }
    this.subscriptions[event].push(callback);
    return () => {
      this.subscriptions[event] = this.subscriptions[event].filter((cb) => cb !== callback);
    };
  }

  once(event: string, callback: (...args: any[]) => void) {
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
        (frame: { keys: { [key: string]: boolean }; events: string[]; frame: number; playerId: string }) => {
          const obj = this.inputManager.toKeyMap(frame.keys);
          if (!room.frameStack[frame.playerId]) {
            room.frameStack[frame.playerId] = [];
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
      onPlayerLeave,
      playerConfig,
      gameInstance,
      seed,
      coreOverrides,
    }: {
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
    if (!playerConfig) {
      playerConfig = {};
    }
    playerConfig = { ...this.player.config, ...playerConfig };
    let room = this.rooms[roomId];
    if (!room) {
      await (() => {
        console.log("Room not found, waiting for room");
        return new Promise<void>((resolve, reject) => {
          const rejected = false;
          this.once("updateRoom", (room: Room) => {
            if (room.roomId === roomId && !rejected) {
              resolve();
            }
          });
          setTimeout(() => {
            reject();
          }, this.options.roomTimeout ?? 5000);
        });
      })();
      room = this.rooms[roomId];
      if (!room) {
        throw new Error("Timed out looking for room");
      }
    }

    return new Promise((resolve) => {
      this.roomSubs[roomId] = this.roomSubs[roomId] ?? [];
      this.roomSubs[roomId].push(
        this.on(
          "state",
          (
            stateJson: string,
            frameStack: {
              [playerId: number]: { keys: any; frame: number; events: string[] }[];
            },
            timestamp: number
          ) => {
            this.subscribeFrame(roomId);
            let roomState = this.roomStates[roomId];

            this.player.currentRoomId = roomId;
            const state: {
              core: number;
              timeElapsed: number;
              frame: number;
              frameDt: number;
              entities: any;
            } = JSON.parse(stateJson);

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
                if (!roomState.frameStack[playerId]) {
                  roomState.frameStack[playerId] = [];
                }
                frames.forEach((frame) => {
                  if (
                    !roomState.frameStack[playerId].length ||
                    roomState.frameStack[playerId][roomState.frameStack[playerId].length - 1].frame < frame.frame
                  ) {
                    roomState.frameStack[playerId].push({
                      keys: this.inputManager.toKeyMap(frame.keys),
                      frame: frame.frame,
                      events: frame.events,
                      playerId: playerId,
                    });
                  }
                });
              });
            }
            if (!roomState.gameModel || roomState.gameModel.destroyed) {
              roomState.gameModel = new GameModel(GameCoordinator.GetInstance(), gameInstance, seed, coreOverrides);
              roomState.gameModel.roomId = roomId;
            }
            if (roomState.gameModel) {
              roomState.gameModel?.loadStateObject(state);
              roomState.gameModel.netId = this.playerId;
            }
            if (roomState.frameStack[this.playerId]) {
              this.listening = true;
            }
            resolve(roomState.gameModel);
          }
        )
      );
      this.emit("requestState", this.playerId, roomId, JSON.stringify(playerConfig));
      this.emit("joinRoom", this.playerId, roomId);
    });
  }

  async connect(): Promise<void> {}

  async initialize(
    roomId: string,
    options: {
      gameInstance: GameInstance<T>;
      seed: string;
      coreOverrides?: { [key: string]: any };
      players: string[];
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void;
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean | undefined;
    }
  ): Promise<GameModel> {
    if (!this.player.connected && !this.options.solohost) {
      await this.connect();
    }
    this.cleanup();
    const players = this.players
      .filter((player) => options.players.includes(player.id))
      .sort((a, b) => a.id.localeCompare(b.id));
    const host = players[0];

    this.touchListener?.replaceRegions(this.options.touchRegions ?? []);
    this.player.currentRoomId = roomId;
    this.player.hostedRooms.push(roomId);

    this.roomSubs[roomId] = this.roomSubs[roomId] ?? [];
    if (host === this.player) {
      this.roomSubs[roomId].push(
        this.on("requestState", (playerId, _roomId, playerConfig) => {
          if (!this.stateRequested) {
            this.stateRequested = [[playerId, JSON.parse(playerConfig || "{}")]];
          } else {
            this.stateRequested.push([playerId, JSON.parse(playerConfig || "{}")]);
          }
        })
      );
    }
    this._onPlayerJoin = options.onPlayerJoin;
    this._onPlayerLeave = options.onPlayerLeave;
    this.subscribeFrame(roomId);

    const roomState = this.roomStates[roomId];

    roomState.gameModel = new GameModel(
      GameCoordinator.GetInstance(),
      options.gameInstance,
      options.seed,
      options.coreOverrides
    );
    roomState.gameModel.roomId = roomId;
    roomState.gameModel.paused = true;

    options.buildWorld(roomState.gameModel, players[0].config);

    for (let i = 0; i < players.length; ++i) {
      const player = players[i];
      this.createPlayer(roomState.gameModel, player.id, player.config!, roomState.gameModel.frame);
    }

    roomState.gameModel.netId = this.playerId;
    this.rooms[roomId] = {
      rebalanceOnLeave: options.rebalanceOnLeave ?? false,
      host: host.id,
      players: players.map((player) => player.id),
      roomId,
    };
    return roomState.gameModel;
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
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void;
      onPlayerJoin: (gameModel: GameModel, playerId: string) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean;
      playerConfig?: Partial<T>;
    }
  ): Promise<GameModel> {
    if (!this.player.connected && !this.options.solohost) {
      await this.connect();
    }
    this.cleanup();
    this.touchListener?.replaceRegions(this.options.touchRegions ?? []);
    this.player.currentRoomId = roomId;
    this.player.hostedRooms.push(roomId);

    this.roomSubs[roomId] = this.roomSubs[roomId] ?? [];
    this.roomSubs[roomId].push(
      this.on("requestState", (playerId, _roomId, playerConfig) => {
        if (!this.stateRequested) {
          this.stateRequested = [[playerId, JSON.parse(playerConfig || "{}")]];
        } else {
          this.stateRequested.push([playerId, JSON.parse(playerConfig || "{}")]);
        }
      })
    );
    this._onPlayerJoin = onPlayerJoin;
    this._onPlayerLeave = onPlayerLeave;
    this.subscribeFrame(roomId);

    const roomState = this.roomStates[roomId];

    roomState.gameModel = new GameModel(GameCoordinator.GetInstance(), gameInstance, seed, coreOverrides);
    roomState.gameModel.roomId = roomId;

    if (!playerConfig) {
      playerConfig = {};
    }
    // playerConfig.name = this.player.name;
    playerConfig = { ...this.player.config, ...playerConfig };

    buildWorld(roomState.gameModel, playerConfig);

    this.createPlayer(roomState.gameModel, this.playerId, playerConfig as T, roomState.gameModel.frame);
    roomState.gameModel.netId = this.playerId;

    this.updateRoom({
      rebalanceOnLeave: rebalanceOnLeave ?? false,
      host: this.playerId,
      players: [this.playerId],
      roomId,
    });

    return roomState.gameModel;
  }

  protected createPlayer(gameModel: GameModel, playerId: string, playerConfig: T, frame: number) {
    const entityId = this._onPlayerJoin(gameModel, playerId, playerConfig);

    console.log("CREATING PLAYER", playerId);
    this.generateFrameStack(gameModel, playerId, frame);
    return entityId;
  }

  generateFrameStack = (gameModel: GameModel, playerId: string, frame: number) => {
    const initalFrameOffset = this.frameOffset;
    const roomState = this.roomStates[gameModel.roomId];
    roomState.frameStack[playerId] = new Array(initalFrameOffset).fill({ keys: {} as any, frame: 0 }).map((_, ind) => {
      return {
        frame: frame + ind,
        keys: this.inputManager.buildKeyMap(),
        events: [],
        playerId: playerId,
      };
    });
  };

  handleInput(gameModel: GameModel) {
    const players = gameModel.getComponentActives("PlayerInput");
    const roomState = this.roomStates[gameModel.roomId];

    for (let i = 0; i < players.length; ++i) {
      let player = players[i];
      if (gameModel.hasComponent(player, PlayerInputSchema)) {
        const PlayerInput = gameModel.getTyped(player, PlayerInputSchema);
        const netId = PlayerInput.id;

        if (
          netId === this.playerId &&
          gameModel.frame + this.frameOffset > roomState.frameStack[netId][roomState.frameStack[netId].length - 1].frame
        ) {
          const currentKeyMap = this.inputManager.getKeyMap();
          const frame: Frame = {
            keys: this.inputManager.keyMapToJsonObject(currentKeyMap),
            frame: gameModel.frame + this.frameOffset,
            playerId: this.playerId,
            events: this.eventsManager.getEvents(),
          };
          this.emit("frame", frame);
        }
        if (roomState.frameStack[netId][0].frame === gameModel.frame) {
          const prevKeyMap = PlayerInput.keyMap;
          const frame = roomState.frameStack[netId].shift()!;
          const nextKeyMap = frame.keys as KeyMap;

          PlayerInput.prevKeyMap = prevKeyMap;
          PlayerInput.keyMap = nextKeyMap;
          PlayerInput.events = frame.events;
        }
      }
    }
  }

  run(gameModel: GameModel) {
    const roomState = this.roomStates[gameModel.roomId];

    if (this.stateRequested?.length) {
      while (this.stateRequested?.length) {
        const [playerId, playerConfig] = this.stateRequested.pop()!;
        this.createPlayer(gameModel, playerId, playerConfig, gameModel.frame);
      }
      this.stateRequested = null;
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

      this.emit("state", JSON.stringify(state), frameStack, +new Date());
      gameModel.loadStateObject(state);
    }

    // if (gameModel.frame % 30 === 0) {
    //   const perf = performance.now();
    //   const physicsSystem = gameModel.getSystem(PhysicsSystem);
    //   physicsSystem?.getEngine?.(gameModel);
    //   var uint8array = physicsSystem.world?.takeSnapshot();
    //   var string = new TextDecoder().decode(uint8array);
    //   const model = gameModel.serializeState();
    //   var modelString = JSON.stringify(model);

    //   const md5String = md5(string);
    //   const modelMd5String = md5(modelString);

    //   console.log(gameModel.frame, md5String, modelMd5String, model, performance.now() - perf);
    // }
    if (gameModel.frame % 300 === 0) {
      const perf = performance.now();
      const physicsSystem = gameModel.getSystem(PhysicsSystem);
      physicsSystem?.getEngine?.(gameModel);
      var uint8array = physicsSystem.world?.takeSnapshot();
      var string = new TextDecoder().decode(uint8array);

      const md5String = md5(string);

      console.log(gameModel.frame, md5String, performance.now() - perf);
    }
  }
}
