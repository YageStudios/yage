import { isPlayerConnect, type ConnectionInstance, type PlayerConnect } from "../connection/ConnectionInstance";
import { SingleplayerConnectionInstance } from "../connection/SingleplayerConnectionInstance";
import { GameInstance } from "./GameInstance";
import type { GameModel } from "./GameModel";
import { InputManager } from "../inputs/InputManager";
import { KeyboardListener } from "../inputs/KeyboardListener";
import AssetLoader from "../loader/AssetLoader";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { UIService } from "../ui/UIService";
import { HistoryConnectionInstance } from "yage/connection/HistoryConnectionInstance";
import {
  isPeerMultiplayerInstanceOptions,
  PeerMultiplayerInstance,
  PeerMultiplayerInstanceOptions,
} from "yage/connection/PeerMultiplayerInstance";
import {
  isSocketIoMultiplayerInstanceOptions,
  SocketIoMultiplayerInstance,
  SocketIoMultiplayerInstanceOptions,
} from "yage/connection/SocketIoMultiplayerInstance";

type QuickStartOptions<T> = {
  gameName: string;
  connection?: "SOCKET" | "PEER" | "SINGLEPLAYER" | "COOP" | "REPLAY" | ConnectionInstance<T>;
  buildWorld?: (gameModel: GameModel, firstPlayerConfig: T) => void;
  onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
  onPlayerLeave?: (gameModel: GameModel, playerId: string) => void;
  dt?: number;
  roomId?: string;
  seed?: string;
  preload: (uiService: UIService) => Promise<void>;
};

export async function QuickStart<T = null>(
  options: QuickStartOptions<T> & { connection: "PEER" },
  playerConfig: PlayerConnect<T>,
  multiplayerConfig: PeerMultiplayerInstanceOptions<T>
): Promise<GameInstance<T>>;
export async function QuickStart<T = null>(
  options: QuickStartOptions<T> & { connection: "SOCKET" },
  playerConfig: PlayerConnect<T>,
  multiplayerConfig: SocketIoMultiplayerInstanceOptions<T>
): Promise<GameInstance<T>>;
export async function QuickStart<T = null>(
  options: QuickStartOptions<T> & { connection: "SINGLEPLAYER" },
  playerConfig?: T
): Promise<GameInstance<T>>;
export async function QuickStart<T = null>(
  options: QuickStartOptions<T> & { connection: "REPLAY" },
  playerConfig?: T
): Promise<GameInstance<T>>;
export async function QuickStart<T = null>(
  {
    roomId = "QuickStart",
    seed = "QuickStart",
    connection = "SINGLEPLAYER",
    buildWorld = () => {},
    onPlayerJoin,
    onPlayerLeave = (gameModel: GameModel, playerId: string) => {
      const players = gameModel.getComponentActives("PlayerInput");
      const player = players.find((p) => {
        const playerInput = gameModel.getTypedUnsafe(PlayerInput, p);
        return playerInput.pid === playerId;
      });
      if (player) {
        gameModel.removeEntity(player);
      }
    },
    preload = async () => {
      await AssetLoader.getInstance().load();
    },
  }: QuickStartOptions<T>,
  playerConfig?: T | PlayerConnect<T>,
  multiplayerConfig?: PeerMultiplayerInstanceOptions<T> | SocketIoMultiplayerInstanceOptions<T>
) {
  let inputManager: InputManager;
  const unsubscribes: (() => void)[] = [];

  const initializeInputManager = () => {
    inputManager = new InputManager();
    const keyboardListener = new KeyboardListener(inputManager);
    keyboardListener.init(["w", "a", "s", "d", "i", "j", "k", "l", "q", "e", "escape", "space", "tab"]);
    unsubscribes.push(() => keyboardListener.destroy());
  };

  const initializeConnection = (
    connection: "SOCKET" | "PEER" | "SINGLEPLAYER" | "COOP" | "REPLAY" | ConnectionInstance<T>,
    playerConfig?: T | PlayerConnect<T>
  ): ConnectionInstance<T> => {
    if (typeof connection !== "string") {
      return connection;
    }
    if (connection === "REPLAY") {
      return new HistoryConnectionInstance<T>(JSON.parse(localStorage.getItem("history") ?? "{}"));
    }
    if (connection === "SINGLEPLAYER") {
      return new SingleplayerConnectionInstance<T>(
        inputManager,
        isPlayerConnect<T>(playerConfig) ? playerConfig.config : playerConfig
      );
    }
    if (connection === "PEER") {
      if (!isPlayerConnect<T>(playerConfig)) {
        throw new Error("Player connect is required for multiplayer");
      }
      if (!isPeerMultiplayerInstanceOptions(multiplayerConfig)) {
        throw new Error("Multiplayer config is required for multiplayer");
      }
      return new PeerMultiplayerInstance<T>(playerConfig, inputManager, multiplayerConfig);
    }
    if (connection === "SOCKET") {
      if (!isPlayerConnect<T>(playerConfig)) {
        throw new Error("Player connect is required for multiplayer");
      }
      if (!isSocketIoMultiplayerInstanceOptions(multiplayerConfig)) {
        throw new Error("Multiplayer config is required for multiplayer");
      }
      return new SocketIoMultiplayerInstance<T>(playerConfig, inputManager, multiplayerConfig);
    }
    throw new Error("Connection type not supported");
  };

  const initializeGameInstance = (connection: ConnectionInstance<T>) => {
    return new GameInstance({
      connection: connection,
      uiService: true,
      buildWorld,
      onPlayerJoin,
      onPlayerLeave,
    });
  };

  await preload(UIService.getInstance());

  initializeInputManager();

  if (typeof connection === "string") {
    connection = initializeConnection(connection, playerConfig);
  }
  await connection.connect();
  const instance: GameInstance<T> = initializeGameInstance(connection);
  instance.initializeRoom(roomId, seed);

  return instance;
}
