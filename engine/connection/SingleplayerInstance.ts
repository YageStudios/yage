import { PlayerInputSchema } from "@/schemas/core/PlayerInput";
import { GameModel, GameModelState } from "@/game/GameModel";
import { InputManager, KeyMap } from "@/inputs/InputManager";
import { ConnectionInstance, PlayerConnect, PlayerConnection } from "./ConnectionInstance";
import { RequireAtLeastOne } from "@/utils/typehelpers";
import { MouseManager } from "@/inputs/MouseManager";
import { TouchListener } from "@/inputs/TouchListener";
import { PlayerEventManager } from "@/inputs/PlayerEventManager";
import { GameCoordinator } from "@/game/GameCoordinator";
import { GameInstance } from "@/game/GameInstance";
import { TouchRegion } from "@/inputs/InputRegion";

export class SingleplayerInstance<T> implements ConnectionInstance<T> {
  messageListeners: ((message: string, time: number, playerId: string) => void)[] = [];

  frameStack: { [playerId: string]: { keys: KeyMap; frame: number; events: string[] }[] } = {};
  frameOffset = 10;
  connected: boolean = true;
  hosting: boolean = true;
  solohost: boolean = true;
  player: PlayerConnection<T>;
  touchListener?: TouchListener;
  eventsManager: PlayerEventManager = new PlayerEventManager();

  address: string = "singleplayer";

  playerId: string = "singleplayer";

  players: PlayerConnection<T>[] = [
    {
      id: "singleplayer",
      name: "singleplayer",
      token: "singleplayer",
      connected: true,
      connectionTime: 0,
      currentRoomId: null,
      hostedRooms: [],
    },
  ];
  gameModel: GameModel;

  constructor(
    public inputManager: InputManager,
    public mouseManager: MouseManager,
    public touchRegions?: TouchRegion[]
  ) {
    this.player = {
      id: "singleplayer",
      name: "singleplayer",
      token: "singleplayer",
      connected: true,
      connectionTime: 0,
      currentRoomId: null,
      hostedRooms: [],
    };

    if (touchRegions) {
      this.touchListener = new TouchListener(this.inputManager);
    }
  }
  updatePlayerConnect(
    player: RequireAtLeastOne<{ name: string; token: string; config: T }, "name" | "token" | "config">
  ): void {
    this.player.name = player.name ?? this.player.name;
    this.player.token = player.token ?? this.player.token;
    this.player.config = player.config ?? this.player.config;
  }

  sendMessage(message: string, includeSelf = true): void {
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
    return () => {};
  }
  onPlayerDisconnect(cb: (playerId: string) => void): () => void {
    return () => {};
  }

  gameCreatePlayer: (gameModel: GameModel, playerId: string, playerConfig: any) => number;

  frameSkipCheck = (gameModel: GameModel): boolean => {
    return false;
  };
  async connect(): Promise<void> {}

  hasRoom(roomId: string): boolean {
    return this.players[0].hostedRooms.includes(roomId);
  }

  async initialize(
    roomId: string,
    options: {
      gameInstance: GameInstance<T>;
      seed: string;
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void;
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean | undefined;
      playerConfig?: Partial<T> | undefined;
    }
  ): Promise<GameModel> {
    return new GameModel(GameCoordinator.GetInstance(), options.gameInstance, options.seed);
  }

  async join(
    _roomId: string,
    {
      gameInstance,
      seed,
    }: {
      gameInstance: any;
      seed: string;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      playerConfig?: any;
    }
  ): Promise<GameModel> {
    return new GameModel(GameCoordinator.GetInstance(), gameInstance, seed);
  }
  async leaveRoom(): Promise<void> {
    this.players[0].hostedRooms = this.players[0].hostedRooms.filter(
      (roomId) => roomId !== this.players[0].currentRoomId
    );
    this.players[0].currentRoomId = null;
  }

  async host(
    roomId: string,
    options: {
      gameInstance: GameInstance<T>;
      seed: string;
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void;
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: any) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean | undefined;

      playerConfig?: any;
    }
  ): Promise<GameModel> {
    this.touchListener?.replaceRegions(this.touchRegions ?? []);
    this.player.currentRoomId = roomId;
    this.player.hostedRooms.push(roomId);

    this.gameCreatePlayer = options.onPlayerJoin;
    if (!options.playerConfig) {
      options.playerConfig = {};
    }
    this.gameModel = new GameModel(GameCoordinator.GetInstance(), options.gameInstance, options.seed);
    options.playerConfig.name = this.player.name;
    const playerConfig = {
      ...(this.player.config ?? {}),
      ...options.playerConfig,
    };
    options.buildWorld(this.gameModel, playerConfig);
    this.createPlayer(this.gameModel, this.gameModel.frame, playerConfig);
    this.gameModel.netId = this.playerId;

    return this.gameModel;
  }

  generateFrameStack = (player: string, frame: number) => {
    const initalFrameOffset = this.frameOffset;
    this.frameStack[player] = new Array(initalFrameOffset).fill({ keys: {} as any, frame: 0 }).map((_, ind) => {
      return {
        frame: frame + ind,
        keys: this.inputManager.buildKeyMap(),
        events: [],
      };
    });
  };

  protected createPlayer(gameModel: GameModel, frame: number, playerConfig?: any) {
    const playerId = this.gameCreatePlayer(gameModel, "singleplayer", playerConfig);
    this.generateFrameStack("singleplayer", frame);
    return playerId;
  }

  handleInput(gameModel: GameModel) {
    const players = gameModel.getComponentActives("PlayerInput");
    for (let i = 0; i < players.length; ++i) {
      const player = players[i];
      const PlayerInput = gameModel.getTyped(player, PlayerInputSchema);
      const netId = PlayerInput.id;

      if (!this.frameStack[netId]) {
        this.generateFrameStack(netId, gameModel.frame);
      }

      if (
        netId === "singleplayer" &&
        gameModel.frame + this.frameOffset > this.frameStack[netId][this.frameStack[netId].length - 1].frame
      ) {
        const currentKeyMap = this.inputManager.getKeyMap();

        this.frameStack[netId].push({
          keys: currentKeyMap,
          frame: gameModel.frame + this.frameOffset,
          events: this.eventsManager.getEvents(),
        });
        // PlayerInput.mousePosition = fromMouseSpace(this.mouseManager.mousePosition, this.pixiViewport);
        // PlayerInput.buttons = this.mouseManager.buttons;
      } else if (netId !== "singleplayer") {
        this.frameStack[netId].push({
          keys: this.inputManager.buildKeyMap(),
          frame: gameModel.frame + this.frameOffset,
          events: this.eventsManager.getEvents(),
        });
      }
      while (this.frameStack[netId][0].frame < gameModel.frame) {
        console.error("old frame:" + netId);
        this.frameStack[netId].shift();
      }
      if (this.frameStack[netId][0].frame === gameModel.frame) {
        const prevKeyMap = PlayerInput.keyMap;
        const frame = this.frameStack[netId].shift()!;
        const nextKeyMap = frame.keys as KeyMap;

        PlayerInput.prevKeyMap = prevKeyMap;
        PlayerInput.keyMap = nextKeyMap;
        PlayerInput.events = frame.events;
      }
    }
  }

  run(gameModel: GameModel) {}
}
