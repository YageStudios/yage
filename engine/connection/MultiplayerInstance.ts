import { PhysicsSystem, PlayerInputSchema } from "@/components";
import { GameModel } from "@/game/GameModel";
import { InputManager, KeyMap } from "@/inputs/InputManager";
import { ConnectionInstance, PlayerConnect, PlayerConnection } from "./ConnectionInstance";
import { md5 } from "@/utils/md5";
import { nanoid } from "nanoid";
import { RequireAtLeastOne } from "@/utils/typehelpers";
import { MouseManager } from "@/inputs/MouseManager";
import { TouchListener, TouchRegion } from "@/inputs/TouchListener";

type Room = {
  roomId: string;
  host: string;
  players: string[];
  rebalanceOnLeave: boolean;
};

export type MultiplayerInstanceOptions<T> = {
  solohost?: boolean;
  touchRegions?: TouchRegion[];
  roomTimeout?: number;
};

export class MultiplayerInstance<T> implements ConnectionInstance<T> {
  stateRequested: null | [string, any][] = null;
  frameStack: { [playerId: string]: { keys: KeyMap; frame: number }[] } = {};
  frameOffset = 5;
  sendingState = false;
  leavingPlayers: [string, number][] = [];

  inRoom: string = "";

  playerId: string = nanoid();
  nickname: string = "";
  listening: boolean;

  gameModel: GameModel | null = null;
  touchListener?: TouchListener | undefined;

  address: string = "";

  subscriptions: { [event: string]: ((...args: any[]) => void)[] } = {};
  onceSubscriptions: { [event: string]: ((...args: any[]) => void)[] } = {};

  messageListeners: ((message: string, time: number, playerId: string) => void)[] = [];
  connectListeners: ((player: PlayerConnect<T>) => void)[] = [];
  disconnectListeners: ((playerId: string) => void)[] = [];

  rooms: Room[] = [];

  players: PlayerConnection<T>[] = [];
  player: PlayerConnection<T>;

  roomSubs: { [roomId: string]: (() => void)[] } = {};
  solohost: boolean;

  constructor(
    player: PlayerConnect<T>,
    public inputManager: InputManager,
    public mouseManager: MouseManager,
    protected options: MultiplayerInstanceOptions<T> = { solohost: false }
  ) {
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
      const index = this.rooms.findIndex((r) => r.host === room.host);
      if (index === -1) {
        this.rooms.push(room);
      } else {
        this.rooms[index] = room;
      }
    });
    this.on("rooms", (rooms: Room[]) => {
      this.rooms = rooms;
    });
    this.on("connect", (player: PlayerConnect<T>) => {
      this.connectListeners.forEach((listener) => listener(player));

      if (this.rooms.length) {
        this.emit("rooms", this.rooms);
      }
    });
    this.on("disconnect", (playerId: string, lastFrame: number) => {
      this.players = this.players.filter((player) => player.id !== playerId);
      this.disconnectListeners.forEach((listener) => listener(playerId));

      if (!this.frameStack[playerId]) {
        return;
      }
      if (!lastFrame) {
        const room = this.rooms.find((room) => room.players.includes(playerId));
        if (room) {
          this.updateRoom({
            ...room,
            players: room.players.filter((player) => player !== playerId),
          });
        }
      }
      lastFrame = lastFrame ?? this.frameStack[playerId][this.frameStack[playerId].length - 1].frame - 1;
      const leavingIndex = this.leavingPlayers.findIndex(([playerId]) => playerId === playerId);
      if (leavingIndex !== -1 && this.leavingPlayers[leavingIndex][1] < lastFrame) {
        this.leavingPlayers[leavingIndex][1] = lastFrame;
      } else if (leavingIndex === -1) {
        this.leavingPlayers.push([playerId, lastFrame]);
        this.emit("disconnect", playerId, lastFrame);
      }
    });

    this.on("updatePlayerConnect", (player: PlayerConnection<T>) => {
      console.log("updatePlayerConnect", "CONNECT CHANGE", this.connectListeners.length);
      this.players = this.players.map((p) => (p.id === player.id ? player : p));
      this.connectListeners.forEach((listener) => listener(player));
    });
  }
  updatePlayerConnect(
    player: RequireAtLeastOne<{ name: string; token: string; config: T }, "name" | "token" | "config">
  ): void {
    this.player.name = player.name ?? this.player.name;
    this.player.token = player.token ?? this.player.token;
    this.player.config = player.config ?? this.player.config;
    this.connectListeners.forEach((listener) => listener(this.player));

    this.emit("updatePlayerConnect", this.player);
  }

  leave() {
    this.listening = false;
    this.sendingState = false;
    this.touchListener?.replaceRegions([]);
    const rooms = this.rooms.filter((room) => room.players.includes(this.playerId));
    rooms.forEach((room) => {
      if (room.host === this.playerId) {
        this.roomSubs[room.roomId]?.forEach((sub) => sub());
        if (room.rebalanceOnLeave) {
        } else {
        }
      } else if (room.players.includes(this.playerId)) {
        this.roomSubs[room.roomId]?.forEach((sub) => sub());

        this.updateRoom({
          ...room,
          players: room.players.filter((player) => player !== this.playerId),
        } as Room);
      }
    });
  }

  _onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
  _onPlayerLeave: (gameModel: GameModel, playerId: string) => void;

  async lobby(): Promise<string[]> {
    return [];
  }
  updateRoom(room: Room) {
    if (this.rooms.find((r) => r.roomId === room.roomId)) {
      this.rooms = this.rooms.map((r) => (r.roomId === room.roomId ? room : r));
    } else {
      this.rooms.push(room);
    }
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
    for (let i = 0; i < gameModel.players.length; ++i) {
      const player = gameModel.players[i];
      if (gameModel.hasComponent(player, PlayerInputSchema)) {
        const PlayerInput = gameModel.getTyped(player, PlayerInputSchema);
        const netId = PlayerInput.id;

        if (!this.frameStack[netId] || !this.frameStack[netId][0]) {
          console.error("dropping slow frame");
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
    this.frameStack = {};

    if (!roomId) {
      return;
    }
    this.roomSubs[roomId]?.forEach((sub) => sub());
    delete this.roomSubs[roomId];
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
    this.roomSubs[roomId].push(
      this.on("frame", (frame: { keys: { [key: string]: boolean }; frame: number; playerId: string }) => {
        const obj = this.inputManager.toKeyMap(frame.keys);
        this.frameStack[frame.playerId].push({
          keys: obj,
          frame: frame.frame,
        });
      })
    );
  }

  async join(
    roomId: string,
    {
      onPlayerLeave,
      playerConfig,
      gameModel,
    }: {
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      playerConfig?: Partial<T>;
      gameModel: GameModel;
    }
  ): Promise<void> {
    if (!this.player.connected) {
      throw new Error("Not connected");
    }
    this.cleanup();
    this._onPlayerLeave = onPlayerLeave;
    this.gameModel = gameModel;
    if (!playerConfig) {
      playerConfig = {};
    }
    playerConfig = { ...this.player.config, ...playerConfig };
    let room = this.rooms.find((room) => room.roomId === roomId);
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
      room = this.rooms.find((room) => room.roomId === roomId);
      if (!room) {
        throw new Error("Timed out looking for room");
      }
    }

    this.subscribeFrame(roomId);
    return new Promise((resolve) => {
      this.roomSubs[roomId] = this.roomSubs[roomId] ?? [];

      this.roomSubs[roomId].push(
        this.on(
          "state",
          (
            stateJson: string,
            frameStack: {
              [playerId: number]: { keys: any; frame: number }[];
            },
            timestamp: number
          ) => {
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
            if (!this.frameStack) {
              this.frameStack = Object.entries(frameStack).reduce(
                (acc, [key, value]) => {
                  acc[+key] = value.map((frame) => {
                    return {
                      keys: this.inputManager.toKeyMap(frame.keys),
                      frame: frame.frame,
                    };
                  });
                  return acc;
                },
                {} as {
                  [playerId: number]: { keys: KeyMap; frame: number }[];
                }
              );
            } else {
              Object.entries(frameStack).forEach(([playerId, frames]) => {
                if (!this.frameStack[playerId]) {
                  this.frameStack[playerId] = [];
                }
                frames.forEach((frame) => {
                  if (
                    !this.frameStack[playerId].length ||
                    this.frameStack[playerId][this.frameStack[playerId].length - 1].frame < frame.frame
                  ) {
                    this.frameStack[playerId].push({
                      keys: this.inputManager.toKeyMap(frame.keys),
                      frame: frame.frame,
                    });
                  }
                });
              });
            }
            if (this.gameModel) {
              this.gameModel?.loadStateObject(state);
              this.gameModel.netId = this.playerId;
            }
            if (this.frameStack[this.playerId]) {
              this.listening = true;
            }
            resolve();
          }
        )
      );
      this.emit("requestState", this.playerId, roomId, JSON.stringify(playerConfig));
      const room = this.rooms.find((room) => room.roomId === roomId);
      if (!room) {
        throw new Error("Room not found");
      }
      this.updateRoom({
        ...room,
        players: [...room.players, this.playerId],
      });
    });
  }

  async connect(address: string): Promise<void> {}

  async host(
    roomId: string,
    {
      gameModel,
      onPlayerJoin,
      onPlayerLeave,
      rebalanceOnLeave,
      playerConfig,
    }: {
      gameModel: GameModel;
      onPlayerJoin: (gameModel: GameModel, playerId: string) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean;
      playerConfig?: Partial<T>;
    }
  ): Promise<void> {
    if (!this.player.connected && !this.options.solohost) {
      await this.connect(this.address);
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

    this.gameModel = gameModel;
    if (!playerConfig) {
      playerConfig = {};
    }
    // playerConfig.name = this.player.name;
    playerConfig = { ...this.player.config, ...playerConfig };
    this.createPlayer(gameModel, this.playerId, playerConfig as T, gameModel.frame);
    this.gameModel.netId = this.playerId;

    this.updateRoom({
      rebalanceOnLeave: rebalanceOnLeave ?? false,
      host: this.playerId,
      players: [this.playerId],
      roomId,
    });
  }

  protected createPlayer(gameModel: GameModel, playerId: string, playerConfig: T, frame: number) {
    const entityId = this._onPlayerJoin(gameModel, playerId, playerConfig);

    console.log("CREATING PLAYER", playerId);
    this.generateFrameStack(playerId, frame);
    return entityId;
  }

  generateFrameStack = (player: string, frame: number) => {
    const initalFrameOffset = this.frameOffset;
    this.frameStack[player] = new Array(initalFrameOffset).fill({ keys: {} as any, frame: 0 }).map((_, ind) => {
      return {
        frame: frame + ind,
        keys: this.inputManager.buildKeyMap(),
      };
    });
  };

  handleInput(gameModel: GameModel) {
    for (let i = 0; i < gameModel.players.length; ++i) {
      const player = gameModel.players[i];
      if (gameModel.hasComponent(player, PlayerInputSchema)) {
        const PlayerInput = gameModel.getTyped(player, PlayerInputSchema);
        const netId = PlayerInput.id;

        if (
          netId === this.playerId &&
          gameModel.frame + this.frameOffset > this.frameStack[netId][this.frameStack[netId].length - 1].frame
        ) {
          const currentKeyMap = this.inputManager.getKeyMap();
          this.frameStack[netId].push({
            keys: currentKeyMap,
            frame: gameModel.frame + this.frameOffset,
          });
          // PlayerInput.mousePosition = fromMouseSpace(this.mouseManager.mousePosition, this.pixiViewport);
          // PlayerInput.buttons = this.mouseManager.buttons;
        }
        while (this.frameStack[netId][0].frame < gameModel.frame) {
          console.error("old frame:" + netId);
          this.frameStack[netId].shift();
        }
        if (this.frameStack[netId][0].frame === gameModel.frame) {
          const prevKeyMap = PlayerInput.keyMap;
          const nextKeyMap = this.frameStack[netId].shift()?.keys as KeyMap;

          PlayerInput.prevKeyMap = prevKeyMap;
          PlayerInput.keyMap = nextKeyMap;
        }
      }
    }
  }

  run(gameModel: GameModel) {
    if (this.sendingState || this.listening) {
      this.emit("frame", {
        keys: this.inputManager.keyMapToJsonObject(
          this.frameStack[this.playerId][this.frameStack[this.playerId].length - 1].keys
        ),
        frame: this.frameStack[this.playerId][this.frameStack[this.playerId].length - 1].frame,
        playerId: this.playerId,
      });
    }

    if (this.stateRequested?.length) {
      while (this.stateRequested?.length) {
        const [playerId, playerConfig] = this.stateRequested.pop()!;
        this.createPlayer(gameModel, playerId, playerConfig, gameModel.frame);
      }
      this.stateRequested = null;
      this.sendingState = true;

      const state = gameModel.serializeState();

      const frameStack = Object.entries(this.frameStack).reduce(
        (acc, [key, value]) => {
          acc[key] = value.map((frame) => {
            return {
              keys: this.inputManager.keyMapToJsonObject(frame.keys),
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

    if (this.leavingPlayers.length) {
      for (let i = 0; i < this.leavingPlayers.length; ++i) {
        if (this.leavingPlayers[i][1] === gameModel.frame) {
          this._onPlayerLeave(gameModel, this.leavingPlayers[i][0]);
          this.leavingPlayers.splice(i, 1);
          delete this.frameStack[this.leavingPlayers[i][0]];
          i--;
        }
      }
    }

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
