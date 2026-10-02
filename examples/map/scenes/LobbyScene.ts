import type { SceneTimestep } from "yage/game/Scene";
import { Scene } from "yage/game/Scene";
import { customAlphabet } from "nanoid";
import type { ConnectionInstance } from "yage/connection/ConnectionInstance";
import { InputManager } from "yage/inputs/InputManager";
import { GameInstance } from "yage/game/GameInstance";
import { GameModel } from "yage/game/GameModel";
import { EntityFactory } from "yage/entity/EntityFactory";
import { KeyboardListener } from "yage/inputs/KeyboardListener";
import { PreconfiguredTouchRegions, TouchListener } from "yage/inputs/TouchListener";
import { PlayerState, defaultPlayerState } from "../types/PlayerState.types";
import { cloneDeep } from "lodash";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { GamepadListener, StandardGamepadRegions } from "yage/inputs/GamepadListener";
import { Button, Column, Model, Row, Text, UIFinal, each, when } from "yage/ui/final";
import { SingleplayerConnectionInstance } from "yage/connection/SingleplayerConnectionInstance";

const nanoid = customAlphabet("234579ACDEFGHJKMNPQRTWXYZ", 5);

interface LobbyPlayerView { netId: string; ready: boolean; }

export class BallLobbyScene extends Scene {
  static sceneName = "BallLobby";

  timestep: SceneTimestep = "continuous";
  dt = 4;

  connection: ConnectionInstance<PlayerState>;

  hosting = false;

  unlisteners: (() => void)[] = [];

  unsub: () => void;
  unsubPlayerConnect: () => void;
  startingGame: boolean;
  instance: GameInstance<PlayerState>;

  private lobbyUi?: UIFinal;
  /** Presentation snapshot: chat/connection message plus per-player ready state. */
  private state?: Model<{ message: string; players: LobbyPlayerView[] }>;

  public initialize = async (args: any[]): Promise<void> => {
    if (args.length) {
      this.instance = args[0].instance;
      this.connection = this.instance.options.connection;
    }

    const inputManager = new InputManager();
    const keyboardListener = new KeyboardListener(inputManager);
    keyboardListener.init(["w", "a", "s", "d", "i", "j", "k", "l", "space"]);
    const gamepadListener = new GamepadListener(inputManager);
    gamepadListener.init(StandardGamepadRegions);

    const touchListener = new TouchListener(inputManager);
    touchListener.replaceRegions(PreconfiguredTouchRegions.TwinStickDoubleTap);
    let addressId;
    let lobbyId;
    if (window.location.hash) {
      lobbyId = window.location.hash.substring(1);
      addressId = nanoid();
    } else {
      lobbyId = nanoid();
      addressId = lobbyId;
      // set search to lobbyId
      window.history.pushState({}, "", "#" + lobbyId);
      this.hosting = true;
    }

    if (!this.connection) {
      this.connection = new SingleplayerConnectionInstance(inputManager, cloneDeep(defaultPlayerState));

      this.unsubPlayerConnect = this.onPlayerConnect();
      await this.attemptConnect(lobbyId);
    } else {
      this.unsubPlayerConnect = this.onPlayerConnect();
      this.connection.updatePlayerConnect({
        config: cloneDeep(defaultPlayerState),
      });
    }

    this.mountLobbyUi();
    this.refreshPlayers();
  };

  /** Starts the game once every connected player is ready; otherwise refreshes the lobby view. */
  private onPlayerConnect = (): (() => void) => {
    return this.connection.onPlayerConnect((playerConnect) => {
      if (!playerConnect.config) return;
      if (!this.startingGame && Object.values(this.connection.players).every((p) => p.config!.ready)) {
        const host = Object.keys(this.connection.players).sort()[0];
        const localHost = this.connection.localPlayers[0].netId;
        const isHosting = host === localHost;
        this.startGame(isHosting);
      } else {
        this.refreshPlayers();
      }
    });
  };

  private mountLobbyUi(): void {
    const state = this.state = new Model<{ message: string; players: LobbyPlayerView[] }>({
      message: "",
      players: [],
    });
    this.lobbyUi = this.mountUIFinal(
      Column({
        style: {
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
        },
      },
        Column({ style: { alignItems: "center", gap: 28, pointerEvents: "auto" } },
          Text("BALL", {
            role: "heading",
            attrs: { "aria-level": 1 },
            style: { fontSize: 72, color: "#ffffff", textShadow: "2px 2px 4px #000000" },
          }),
          when(() => state.get<string>("message") !== "", () =>
            Text(() => state.get<string>("message"), {
              id: "lobbyMessage",
              style: { fontSize: 20, color: "#ff8888", whiteSpace: "pre-wrap", textAlign: "center" },
            })),
          Row({
            id: "readyButtons",
            style: { gap: 24, justifyContent: "center" },
          }, each(state.select<readonly LobbyPlayerView[]>("players"), player => player.netId, player =>
            Button({
              style: { minWidth: 300, minHeight: 100, fontSize: 32, textTransform: "uppercase" },
              on: {
                activate: () => this.toggleReady(player.peek().netId),
              },
            }, Text(() => `${player.get().ready ? "Ready" : "Not Ready"} — ${player.get().netId}`)))))));
  }

  private toggleReady(netId: string): void {
    const index = this.connection.localPlayers.findIndex((player) => player.netId === netId);
    if (index === -1) return;
    const player = this.connection.localPlayers[index];
    this.connection.updatePlayerConnect(
      {
        config: {
          ...player.config!,
          ready: !player.config!.ready,
        },
      },
      index,
    );
    this.refreshPlayers();
  }

  private refreshPlayers(): void {
    this.state?.set("players", this.connection.localPlayers.map((player) => ({
      netId: player.netId,
      ready: player.config?.ready ?? false,
    })));
  }

  startGame = (hosting: boolean) => {
    this.startingGame = true;

    this.changeScene("BallGame", {
      instance: this.instance,
      hosting: hosting,
      wave: 1,
    });
  };

  async attemptConnect(lobbyId: string) {
    this.instance = new GameInstance({
      connection: this.connection,
      uiService: true,
      buildWorld: (gameModel: GameModel, firstPlayerConfig: PlayerState) => {
        const zero_zero = gameModel.addEntity();
        gameModel.addComponent("Transform", zero_zero, {
          x: 0,
          y: 0,
        });
        gameModel.addComponent("Radius", zero_zero, { radius: 10 });
      },
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: PlayerState & { name: string }) => {
        const player = EntityFactory.getInstance().generateEntity(gameModel, "ball");

        gameModel.logEntity(player, true);

        const playerInput = gameModel.getTypedUnsafe(player, PlayerInput);
        playerInput.keyMap = InputManager.buildKeyMap();
        playerInput.pid = playerId;
        playerInput.name = playerConfig.name;

        const index = gameModel.players.length - 1;
        const angle = (index * Math.PI * 2) / 3;

        return player;
      },
      onPlayerLeave: (gameModel: GameModel, playerId: string) => {
        const players = gameModel.getComponentActives("PlayerInput");
        const player = players.find((p) => {
          const playerInput = gameModel.getTypedUnsafe(p, PlayerInput);
          return playerInput.pid === playerId;
        });
        if (player) {
          gameModel.removeEntity(player);
        }
      },
    });

    this.unlisteners.push(
      this.connection.onPlayerConnect((player) => {
        console.log("Player connected", player);
      })
    );
    this.unsub = this.connection.onReceiveMessage((message) => {
      console.log("message", message);
      this.handleMessage(message, false);
    });

    if (!this.hosting) {
      try {
        await this.connection.connect();
      } catch (e) {
        console.error(e);
        this.state?.set("message", "Failed to connect");
        return;
      }
    }
  }

  handleMessage = (message: string, self: boolean) => {
    if (!this.state) return;
    const label = this.state.get<string>("message") + "\n" + (self ? "You: " + message : "Thm: " + message);
    const lines = label.split("\n");
    if (lines.length > 3) {
      this.state.set("message", lines.slice(1).join("\n"));
    } else {
      this.state.set("message", label);
    }
  };

  run = () => {};

  public destroy = (): void => {
    this.lobbyUi?.dispose();
    this.lobbyUi = undefined;
    this.state = undefined;
    super.destroy();
    this.unsub?.();
    this.unlisteners.forEach((unlistener) => unlistener());
    this.unsubPlayerConnect();
  };
}
