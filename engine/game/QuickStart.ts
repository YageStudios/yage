import type { ConnectionInstance } from "../connection/ConnectionInstance";
import { SingleplayerConnectionInstance } from "../connection/SingleplayerConnectionInstance";
import { GameInstance } from "./GameInstance";
import type { GameModel } from "./GameModel";
import type { SceneTimestep } from "./Scene";
import Ticker from "./Ticker";
import { InputManager } from "../inputs/InputManager";
import { KeyboardListener } from "../inputs/KeyboardListener";
import AssetLoader from "../loader/AssetLoader";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { UIService } from "../ui/UIService";
import { HistoryConnectionInstance } from "yage/connection/HistoryConnectionInstance";

export const QuickStart = async <T>(
  {
    gameName = "QuickStart",
    roomId = "QuickStart",
    seed = "QuickStart",
    connection = "SINGLEPLAYER",
    buildWorld = (gameModel: GameModel, firstPlayerConfig: T) => {},
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
    dt = 16,
    preload = async () => {
      await AssetLoader.getInstance().load();
    },
  }: {
    gameName: string;
    connection?: "MULTIPLAYER" | "SINGLEPLAYER" | "COOP" | "REPLAY" | ConnectionInstance<T>;
    buildWorld?: (gameModel: GameModel, firstPlayerConfig: T) => void;
    onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
    onPlayerLeave?: (gameModel: GameModel, playerId: string) => void;
    dt?: number;
    roomId?: string;
    seed?: string;
    preload: (uiService: UIService) => Promise<void>;
  },
  playerConfig?: T
) => {
  const timestep: SceneTimestep = "fixed";

  const initializeTicker = (run: (dt?: number) => void) => {
    const ticker = new Ticker(timestep, dt ? 1000 / dt : 60);
    ticker.add(run);
    return ticker;
  };

  let inputManager: InputManager;
  const unsubscribes: (() => void)[] = [];

  const initializeInputManager = () => {
    inputManager = new InputManager();
    const keyboardListener = new KeyboardListener(inputManager);
    keyboardListener.init(["w", "a", "s", "d", "i", "j", "k", "l", "space"]);
    unsubscribes.push(() => keyboardListener.destroy());
  };

  const initializeConnection = (
    connection: "MULTIPLAYER" | "SINGLEPLAYER" | "COOP" | "REPLAY" | ConnectionInstance<T>,
    playerConfig?: T
  ): ConnectionInstance<T> => {
    if (typeof connection !== "string") {
      return connection;
    }
    if (connection === "REPLAY") {
      return new HistoryConnectionInstance<T>(JSON.parse(localStorage.getItem("history")!));
    }
    if (connection === "SINGLEPLAYER") {
      if (!playerConfig) {
        throw new Error("Player config required");
      }
      return new SingleplayerConnectionInstance<T>(inputManager, playerConfig);
    }
    throw new Error("Connection type not supported");
  };

  const initializeGameInstance = (connection: ConnectionInstance<T>) => {
    return new GameInstance({
      gameName: gameName,
      connection: connection,
      uiService: true,
      buildWorld,
      onPlayerJoin,
      onPlayerLeave,
    });
  };

  await preload(UIService.getInstance());

  const run = (dt?: number) => {
    instance.run();
  };

  const ticker = initializeTicker(run);

  initializeInputManager();

  if (typeof connection === "string") {
    connection = initializeConnection(connection, playerConfig);
  }

  const instance: GameInstance<T> = initializeGameInstance(connection);

  instance.initializeRoom(roomId, seed);

  ticker.start();
};
