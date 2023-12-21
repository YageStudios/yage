import { GameModel, GameModelState } from "@/game/GameModel";
import { MouseManager } from "@/inputs/MouseManager";
import { RequireAtLeastOne } from "@/utils/typehelpers";
import { InputManager } from "@/inputs/InputManager";
import { TouchListener } from "@/inputs/TouchListener";

export type PlayerConnection = {
  id: string;
  name: string;
  token: string;
  connectionId?: string;
  connected: boolean;
  connectionTime: number;
  currentRoomId: string | null;
  hostedRooms: string[];
  config?: any;
};

export type PlayerConnect = {
  id: string;
  name: string;
  token: string;
  config?: any;
};
export abstract class ConnectionInstance {
  abstract players: PlayerConnection[];
  abstract playerId: string;
  abstract player: PlayerConnection;
  abstract inputManager: InputManager;
  abstract touchListener?: TouchListener;
  abstract mouseManager: MouseManager;
  abstract solohost: boolean;

  abstract address: string;

  abstract updatePlayerConnect(
    player: RequireAtLeastOne<{ name: string; token: string; config: any }, "name" | "token" | "config">
  ): void;

  abstract connect(address?: string): Promise<void>;
  abstract leave(): void;

  abstract host(
    roomId: string,
    options: {
      gameModel: GameModel;
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: any) => number;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      rebalanceOnLeave?: boolean;
      playerConfig?: any;
    }
  ): Promise<void>;

  abstract join(
    roomId: string,
    options: {
      gameModel: GameModel;
      onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
      playerConfig?: any;
    }
  ): Promise<void>;

  abstract frameSkipCheck(gameModel: GameModel): boolean;
  abstract handleInput(gameModel: GameModel): void;
  abstract run(gameModel: GameModel): void;

  abstract sendMessage(message: string, includeSelf?: boolean): void;
  abstract onReceiveMessage(cb: (message: string) => void): () => void;

  abstract onPlayerConnect(cb: (player: PlayerConnect) => void): () => void;
  abstract onPlayerDisconnect(cb: (playerId: string) => void): () => void;
}
