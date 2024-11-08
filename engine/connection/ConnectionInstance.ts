import type { GameModel } from "yage/game/GameModel";
import type { RequireAtLeastOne } from "yage/utils/typehelpers";
import type { InputEventType, InputManager } from "yage/inputs/InputManager";
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
export abstract class ConnectionInstance<T> {
  abstract players: PlayerConnection<T>[];
  abstract player: PlayerConnection<T>;
  abstract localPlayers: PlayerConnection<T>[];
  abstract playerEventManager: PlayerEventManager;
  abstract inputManager: InputManager;
  abstract touchListener?: TouchListener;
  abstract solohost: boolean;

  abstract address: string;

  abstract updatePlayerConnect(
    player: RequireAtLeastOne<{ name: string; token: string; config: T }, "name" | "token" | "config">,
    index?: number | string
  ): void;

  abstract connect(): Promise<void>;
  abstract leaveRoom(roomId: string, localPlayerIndex?: number): void;

  abstract hasRoom(roomId: string): boolean;

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
