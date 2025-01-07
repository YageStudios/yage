import type { GameModel } from "yage/game/GameModel";
import type { RequireAtLeastOne } from "yage/utils/typehelpers";
import type { InputEventType, InputManager, KeyMap } from "yage/inputs/InputManager";
import type { TouchListener } from "yage/inputs/TouchListener";
import type { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import type { GameInstance } from "yage/game/GameInstance";

export type PlayerConnection<T> = {
  netId: string;
  uniqueId: string;
  token: string;
  connectionId?: string;
  connected: boolean;
  connectionTime: number;
  currentRoomId: string | null;
  roomsSynced: boolean;
  hostedRooms: string[];
  inputType?: InputEventType;
  inputIndex?: number;
  config?: T;
};

export type PlayerConnect<T> = {
  netId: string;
  uniqueId: string;
  token: string;
  inputType?: InputEventType;
  inputIndex?: number;
  config?: T;
};

export const isPlayerConnect = <T>(player: any): player is PlayerConnect<T> => {
  return (player as PlayerConnect<T>)?.config !== undefined && player?.netId !== undefined;
};

export type Frame = { keys: KeyMap | { [key: string]: boolean }; frame: number; events: string[]; playerId: string };

export type FrameStack = { [playerId: string]: Frame[] };

export type ReplayStack<T> = {
  seed: string;
  startTimestamp: number;
  frames: FrameStack;
  configs: { [playerId: string]: T | undefined };
  stateHashes: {
    [frame: number]: string;
  };
  snapshots: {
    [frame: number]: any;
  };
};

export type Room = {
  roomId: string;
  host: string;
  players: string[];
  rebalanceOnLeave: boolean;
};

export type RoomState = {
  gameModel: GameModel;
  frameStack: FrameStack;
  lastFrame: { [playerId: string]: number };
};

export abstract class ConnectionInstance<T> {
  abstract players: PlayerConnection<T>[];
  abstract player: PlayerConnection<T>;
  abstract localPlayers: PlayerConnection<T>[];
  abstract playerEventManager: PlayerEventManager;
  abstract inputManager: InputManager;
  abstract touchListener?: TouchListener;
  abstract roomStates: { [roomId: string]: RoomState };
  abstract rooms: { [roomId: string]: Room };

  abstract address: string;

  abstract updatePlayerConnect(
    player: RequireAtLeastOne<{ name: string; token: string; config: T }, "name" | "token" | "config">,
    index?: number | string
  ): void;

  abstract connect(): Promise<void>;
  abstract leaveRoom(roomId: string, localPlayerIndex?: number): void;

  abstract roomHasPlayers(roomId: string): Promise<boolean>;

  abstract firstFrame(gameModel: GameModel, firstPlayerConfig: any): void | Promise<void>;

  abstract initialize(
    roomId: string,
    options: {
      players: string[];
      gameInstance: GameInstance<T>;
      seed: string;
      coreOverrides?: { [key: string]: any };
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void | Promise<void>;
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean;
      playerConfig?: Partial<T>;
    }
  ): Promise<GameModel>;

  abstract host(
    roomId: string,
    options: {
      gameInstance: GameInstance<T>;
      seed: string;
      coreOverrides?: { [key: string]: any };
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void | Promise<void>;
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean;
      playerConfig?: Partial<T>;
    }
  ): Promise<GameModel>;

  abstract join(
    roomId: string,
    options: {
      gameInstance: GameInstance<T>;
      seed: string;
      coreOverrides?: { [key: string]: any };
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      playerConfig?: Partial<T>;
    }
  ): Promise<GameModel>;

  abstract startFrame(gameModel: GameModel): boolean | void;
  abstract endFrame(gameModel: GameModel): void;

  abstract sendMessage(message: string, includeSelf?: boolean): void;
  abstract onReceiveMessage(cb: (message: string) => void): () => void;

  abstract onPlayerConnect(cb: (player: PlayerConnect<T>) => void): () => void;
  abstract onPlayerDisconnect(cb: (playerId: string) => void): () => void;
}
