import type { GameModel, GameModelState } from "yage/game/GameModel";
import type { RequireAtLeastOne } from "yage/utils/typehelpers";
import type { InputEventType, InputManager, KeyMap } from "yage/inputs/InputManager";
import type { TouchListener } from "yage/inputs/TouchListener";
import type { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import type { GameInstance } from "yage/game/GameInstance";
import type { Vector2d } from "yage/utils/vector";

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

export type Frame = {
  keys: KeyMap | { [key: string]: boolean };
  mousePosition?: Vector2d;
  buttons?: number;
  mouseActive?: boolean;
  frame: number;
  events: string[];
  playerId: string;
  roomId?: string;
};

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

export type SerializedRoomFrame = {
  keys: { [key: string]: boolean };
  mousePosition?: Vector2d;
  buttons?: number;
  mouseActive?: boolean;
  frame: number;
  events: string[];
  roomId?: string;
};

export type SerializedRoomFrameStack = {
  [playerId: string]: SerializedRoomFrame[];
};

export type QueueRoomEventOptions = {
  /** Exact deterministic frame requested by the caller. Past/already-published frames are clamped forward. */
  targetFrame?: number;
};

/**
 * An authority snapshot used to recover a lockstep room after a state-hash
 * mismatch. Only unconsumed frames are included, so restoring this value and
 * replaying the queued frames converges the recipient on the authority state.
 */
export type RoomRecoveryState = {
  roomId: string;
  state: GameModelState;
  frameStack: SerializedRoomFrameStack;
  lastFrame: { [playerId: string]: number };
};

export type RoomPreloadOptions<T> = {
  players?: string[];
  gameInstance: GameInstance<T>;
  seed: string;
  coreOverrides?: { [key: string]: any };
  buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void | Promise<void>;
  onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
  onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
  rebalanceOnLeave?: boolean;
  playerConfig?: Partial<T>;
};

export type ActivatePreloadedRoomOptions<T> = {
  localPlayerIndex?: number;
  deferPlayerEntity?: boolean;
  playerConfig?: Partial<T>;
  gameInstance: GameInstance<T>;
  seed: string;
  coreOverrides?: { [key: string]: any };
  onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
  onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
};

export abstract class ConnectionInstance<T> {
  abstract players: PlayerConnection<T>[];
  abstract player: PlayerConnection<T>;
  abstract localPlayers: PlayerConnection<T>[];
  abstract preloadedRoomIds: Set<string>;
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
  abstract leaveRoom(roomId: string, frame: number, localPlayerIndex?: number): void;

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
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      playerConfig?: Partial<T>;
      localPlayerIndex?: number;
    }
  ): Promise<GameModel>;

  abstract preloadRoom(roomId: string, options: RoomPreloadOptions<T>): Promise<GameModel>;
  abstract activatePreloadedRoom(roomId: string, options: ActivatePreloadedRoomOptions<T>): Promise<GameModel>;

  abstract startFrame(gameModel: GameModel): boolean | void;
  abstract endFrame(gameModel: GameModel): void;

  requestStep?(): boolean;
  onStepRequested?(cb: () => void): () => void;

  abstract sendMessage(message: string, includeSelf?: boolean): void;
  abstract onReceiveMessage(cb: (message: string, time: number, playerId: string) => void): () => void;

  abstract onPlayerConnect(cb: (player: PlayerConnect<T>) => void): () => void;
  abstract onPlayerDisconnect(cb: (playerId: string) => void): () => void;

  /**
   * Schedule a serialized player event on one exact room frame. Implementations
   * that do not own a live lockstep queue may return null.
   */
  queueRoomEvent(
    _roomId: string,
    _playerId: string,
    _event: string,
    _data: unknown,
    _options: QueueRoomEventOptions = {},
  ): number | null {
    return null;
  }
  /** Optional recovery hook for transports that maintain a live lockstep room. */
  captureRoomRecoveryState(_roomId: string): RoomRecoveryState | null {
    return null;
  }

  /** Optional recovery hook for transports that maintain a live lockstep room. */
  async restoreRoomRecoveryState(_recovery: RoomRecoveryState): Promise<boolean> {
    return false;
  }
}
