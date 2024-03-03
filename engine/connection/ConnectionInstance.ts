import { GameModel } from "@/game/GameModel";
import { RequireAtLeastOne } from "@/utils/typehelpers";
import { InputEventType, InputManager } from "@/inputs/InputManager";
import { TouchListener } from "@/inputs/TouchListener";
import { PlayerEventManager } from "@/inputs/PlayerEventManager";
import { GameInstance } from "@/game/GameInstance";

export type PlayerConnection<T> = {
  id: string;
  name: string;
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
  id: string;
  name: string;
  token: string;
  inputType?: InputEventType;
  inputIndex?: number;
  config?: T;
};
export abstract class ConnectionInstance<T> {
  abstract players: PlayerConnection<T>[];
  abstract player: PlayerConnection<T>;
  abstract localPlayers: PlayerConnection<T>[];
  abstract eventsManager: PlayerEventManager;
  abstract inputManager: InputManager;
  abstract touchListener?: TouchListener;
  abstract solohost: boolean;

  abstract address: string;

  abstract updatePlayerConnect(
    player: RequireAtLeastOne<{ name: string; token: string; config: T }, "name" | "token" | "config">,
    index?: number | string
  ): void;

  abstract connect(): Promise<void>;
  abstract leaveRoom(): void;

  abstract hasRoom(roomId: string): boolean;

  abstract initialize(
    roomId: string,
    options: {
      players: string[];
      gameInstance: GameInstance<T>;
      seed: string;
      coreOverrides?: { [key: string]: any };
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void;
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
      buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void;
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

  abstract frameSkipCheck(gameModel: GameModel): boolean;
  abstract handleInput(gameModel: GameModel): void;
  abstract run(gameModel: GameModel): void;

  abstract sendMessage(message: string, includeSelf?: boolean): void;
  abstract onReceiveMessage(cb: (message: string) => void): () => void;

  abstract onPlayerConnect(cb: (player: PlayerConnect<T>) => void): () => void;
  abstract onPlayerDisconnect(cb: (playerId: string) => void): () => void;
}
