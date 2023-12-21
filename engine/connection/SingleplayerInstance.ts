import { PlayerInputSchema } from "@/components";
import { GameModel, GameModelState } from "@/game/GameModel";
import { InputManager, KeyMap } from "@/inputs/InputManager";
import { ConnectionInstance, PlayerConnect, PlayerConnection } from "./ConnectionInstance";
import { RequireAtLeastOne } from "@/utils/typehelpers";
import { MouseManager } from "@/inputs/MouseManager";
import { TouchListener, TouchRegion } from "@/inputs/TouchListener";

export class SingleplayerInstance implements ConnectionInstance {
  messageListeners: ((message: string, time: number, playerId: string) => void)[] = [];

  frameStack: { [playerId: string]: { keys: KeyMap; frame: number }[] } = {};
  frameOffset = 10;
  connected: boolean = true;
  hosting: boolean = true;
  solohost: boolean = true;
  player: PlayerConnection;
  touchListener?: TouchListener;

  address: string = "singleplayer";

  playerId: string = "singleplayer";

  players: PlayerConnection[] = [
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
    player: RequireAtLeastOne<{ name: string; token: string; config: any }, "name" | "token" | "config">
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
  onPlayerConnect(cb: (player: PlayerConnect) => void): () => void {
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

  async join(roomId: string): Promise<void> {
    return;
  }
  async leave(): Promise<void> {
    this.players[0].hostedRooms = this.players[0].hostedRooms.filter(
      (roomId) => roomId !== this.players[0].currentRoomId
    );
    this.players[0].currentRoomId = null;
  }

  async host(
    roomId: string,
    options: {
      gameModel: GameModel;
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: any) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean | undefined;

      playerConfig?: any;
    }
  ): Promise<void> {
    this.touchListener?.replaceRegions(this.touchRegions ?? []);
    this.player.currentRoomId = roomId;
    this.player.hostedRooms.push(roomId);

    this.gameCreatePlayer = options.onPlayerJoin;
    if (!options.playerConfig) {
      options.playerConfig = {};
    }
    options.playerConfig.name = this.player.name;
    this.createPlayer(options.gameModel, options.gameModel.frame, {
      ...(this.player.config ?? {}),
      ...options.playerConfig,
    });
    options.gameModel.netId = this.playerId;
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

  protected createPlayer(gameModel: GameModel, frame: number, playerConfig?: any) {
    const playerId = this.gameCreatePlayer(gameModel, "singleplayer", playerConfig);
    this.generateFrameStack("singleplayer", frame);
    return playerId;
  }

  handleInput(gameModel: GameModel) {
    for (let i = 0; i < gameModel.players.length; ++i) {
      const player = gameModel.players[i];
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
        });
        // PlayerInput.mousePosition = fromMouseSpace(this.mouseManager.mousePosition, this.pixiViewport);
        // PlayerInput.buttons = this.mouseManager.buttons;
      } else if (netId !== "singleplayer") {
        this.frameStack[netId].push({
          keys: this.inputManager.buildKeyMap(),
          frame: gameModel.frame + this.frameOffset,
        });
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

  run(gameModel: GameModel) {}
}
