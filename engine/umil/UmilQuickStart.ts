import type { GameModel } from "yage/game/GameModel";
import { GameInstance } from "yage/game/GameInstance";
import { UIService } from "yage/ui/UIService";
import AssetLoader from "yage/loader/AssetLoader";
import { InputManager } from "yage/inputs/InputManager";
import { KeyboardListener } from "yage/inputs/KeyboardListener";
import type { PlayerConnect } from "yage/connection/ConnectionInstance";
import { SingleplayerConnectionInstance } from "yage/connection/SingleplayerConnectionInstance";
import { CoopConnectionInstance } from "yage/connection/CoopConnectionInstance";
import { PeerMultiplayerInstance, type PeerMultiplayerInstanceOptions } from "yage/connection/PeerMultiplayerInstance";
import {
  SocketIoMultiplayerInstance,
  type SocketIoMultiplayerInstanceOptions,
} from "yage/connection/SocketIoMultiplayerInstance";
import { UmilFlow } from "./UmilFlow";
import type { UmilConfig, UmilResult } from "./types";
import { UmilInputType } from "./types";
import type { InputEventType } from "yage/inputs/InputManager";
import { InputEventType as InputEventTypeEnum } from "yage/inputs/InputManager";
import { ensureMobileFullscreenButton } from "yage/game/mobileFullscreen";
import { PeerRoomDiscovery } from "./PeerRoomDiscovery";

type UmilQuickStartOptions<T> = {
  gameName: string;
  gameVersion?: string;
  umilConfig?: Partial<UmilConfig>;
  buildWorld?: (gameModel: GameModel, firstPlayerConfig: T) => void;
  onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: T) => number;
  onPlayerLeave?: (gameModel: GameModel, playerId: string) => void;
  roomId?: string;
  seed?: string;
  preload?: (uiService: UIService) => Promise<void>;
  playerConfig?: T;
  peerOptions?: PeerMultiplayerInstanceOptions<T>;
  socketOptions?: SocketIoMultiplayerInstanceOptions<T>;
};

export async function UmilQuickStart<T = null>({
  gameName,
  gameVersion = "1",
  umilConfig = {},
  buildWorld = () => {},
  onPlayerJoin,
  onPlayerLeave = () => {},
  roomId = "QuickStart",
  seed = "QuickStart",
  preload = async () => {
    await AssetLoader.getInstance().load();
  },
  playerConfig,
  peerOptions,
  socketOptions,
}: UmilQuickStartOptions<T>) {
  // Detect E2E mode - skip UMIL in E2E mode
  const isE2E = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("e2e") === "true";

  if (isE2E) {
    // Run standard flow in E2E mode
    const inputManager = new InputManager();
    const keyboardListener = new KeyboardListener(inputManager);
    keyboardListener.init();

    const connection = new SingleplayerConnectionInstance<T>(inputManager, playerConfig);
    await connection.connect();

    const instance = new GameInstance<T>({
      connection,
      uiService: true,
      buildWorld,
      onPlayerJoin,
      onPlayerLeave,
    });

    instance.initializeRoom(roomId, seed);
    ensureMobileFullscreenButton();
    return instance;
  }

  // Run preload before UMIL flow
  await preload(UIService.getInstance());

  // Run UMIL flow first
  const config: UmilConfig = {
    appName: gameName,
    appVersion: gameVersion,
    maxLocalPlayers: 4,
    maxOnlinePlayers: 4,
    allowLocalOnly: true,
    allowOnline: true,
    ...umilConfig,
  };

  const umilFlow = new UmilFlow<T>(config, playerConfig as T, peerOptions || socketOptions);
  const result: UmilResult<T> = await umilFlow.start();

  // Configure player inputs for UI service
  const uiService = UIService.getInstance();
  uiService.playerInputs = result.localPlayers.map((player) => {
    let eventType: InputEventType;
    switch (player.inputType) {
      case UmilInputType.KEYBOARD:
        eventType = InputEventTypeEnum.KEYBOARD;
        break;
      case UmilInputType.GAMEPAD:
        eventType = InputEventTypeEnum.GAMEPAD;
        break;
      case UmilInputType.TOUCH:
        eventType = InputEventTypeEnum.TOUCH;
        break;
      case UmilInputType.MOUSE:
      default:
        eventType = InputEventTypeEnum.MOUSE;
        break;
    }
    return [eventType, player.inputIndex] as [InputEventType, number];
  });

  // Create input manager with proper configuration
  const inputManager = new InputManager(false);
  const keyboardListener = new KeyboardListener(inputManager);
  keyboardListener.init();

  // Build player connect for multiplayer
  let playerConnect: PlayerConnect<T> | undefined;
  if (result.connection === "PEER" || result.connection === "SOCKET") {
    playerConnect = {
      netId: result.nickname,
      uniqueId: result.nickname,
      token: "",
      config: playerConfig as T,
    };
  }

  // Create appropriate connection based on UMIL result
  let connection = result.connectionInstance;

  switch (result.connection) {
    case "COOP":
      if (connection) {
        break;
      }
      // Build player inputs array for CoopConnectionInstance
      const players: [InputEventType, number, T | undefined][] = result.localPlayers.map((player) => {
        let eventType: InputEventType;
        switch (player.inputType) {
          case UmilInputType.KEYBOARD:
            eventType = InputEventTypeEnum.KEYBOARD;
            break;
          case UmilInputType.GAMEPAD:
            eventType = InputEventTypeEnum.GAMEPAD;
            break;
          case UmilInputType.TOUCH:
            eventType = InputEventTypeEnum.TOUCH;
            break;
          case UmilInputType.MOUSE:
          default:
            eventType = InputEventTypeEnum.MOUSE;
            break;
        }
        return [eventType, player.inputIndex, playerConfig];
      });
      connection = new CoopConnectionInstance<T>(inputManager, players);
      break;

    case "PEER":
      if (connection) {
        break;
      }
      if (!playerConnect) {
        throw new Error("Player connect is required for multiplayer");
      }
      if (!peerOptions) {
        throw new Error("Peer options are required for PEER connection");
      }
      connection = new PeerMultiplayerInstance<T>(playerConnect, inputManager, {
        ...peerOptions,
        address: result.roomId || peerOptions.address,
      });
      break;

    case "SOCKET":
      if (connection) {
        break;
      }
      if (!playerConnect) {
        throw new Error("Player connect is required for multiplayer");
      }
      if (!socketOptions) {
        throw new Error("Socket options are required for SOCKET connection");
      }
      connection = new SocketIoMultiplayerInstance<T>(playerConnect, inputManager, {
        ...socketOptions,
        address: result.roomId || socketOptions.address,
      });
      break;

    case "SINGLEPLAYER":
    default:
      if (!connection) {
        connection = new SingleplayerConnectionInstance<T>(inputManager, playerConfig);
      }
      break;
  }

  if (!result.connectionInstance) {
    await connection.connect();
  }

  const instance = new GameInstance<T>({
    connection,
    uiService: true,
    buildWorld,
    onPlayerJoin,
    onPlayerLeave,
  });

  if (result.connection === "PEER" && result.connectionInstance && !result.isHost && result.roomId) {
    await new Promise<void>((resolve, reject) => {
      if (connection.rooms[result.roomId]) {
        resolve();
        return;
      }

      let settled = false;
      const unsubscribe = connection.on("updateRoom", (_playerId: string, room: { roomId: string }) => {
        if (!settled && room.roomId === result.roomId) {
          settled = true;
          unsubscribe();
          resolve();
        }
      });

      setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        unsubscribe();
        reject(new Error("Timed out waiting for host room"));
      }, 5000);
    });
  }

  await instance.initializeRoom(result.roomId || roomId, seed, {
    players:
      result.connection === "PEER" && result.isHost
        ? connection.localPlayers.map((player) => player.netId)
        : undefined,
  });

  if (result.connection === "PEER" && result.isHost && peerOptions && result.roomId) {
    const discovery = new PeerRoomDiscovery({
      prefix: peerOptions.prefix,
      host: peerOptions.host,
      lobbyId: `${gameName.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}-${gameVersion
        .replace(/[^a-z0-9_-]/gi, "-")
        .toLowerCase()}-lobby`,
    });
    await discovery.start();

    const publishRoom = () => {
      const room = connection.rooms[result.roomId!];
      discovery.publishRoom({
        roomId: result.roomId!,
        roomName: `${result.nickname}'s Room`,
        hostName: result.nickname,
        currentPlayers: room?.players.length ?? connection.localPlayers.length,
        maxPlayers: config.maxOnlinePlayers ?? 4,
      });
    };

    publishRoom();
    connection.onPlayerConnect(publishRoom);
    connection.onPlayerDisconnect(publishRoom);

    if (typeof window !== "undefined") {
      window.addEventListener(
        "beforeunload",
        () => {
          discovery.unpublishRoom(result.roomId!);
          discovery.stop();
        },
        { once: true }
      );
    }
  }

  ensureMobileFullscreenButton();

  return instance;
}
