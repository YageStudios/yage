import type { SceneTimestep } from "@/game/Scene";
import { Scene } from "@/game/Scene";
import { MouseManager } from "@/inputs/MouseManager";
import { Position } from "@/ui/Rectangle";
import { PeerMultiplayerInstance } from "@/connection/PeerMultiplayerInstance";
import { customAlphabet } from "nanoid";
import { ConnectionInstance } from "@/connection/ConnectionInstance";
import { InputManager } from "@/inputs/InputManager";
import { GameInstance } from "@/game/GameInstance";
import { GameModel } from "@/game/GameModel";
import { EntityFactory } from "@/entity/EntityFactory";
import { TransformSchema } from "@/schemas/entity/Transform";
import { Box } from "@/ui/Box";
import { KeyboardListener } from "@/inputs/KeyboardListener";
import { PreconfiguredTouchRegions, TouchListener } from "@/inputs/TouchListener";
import { rotateVector2d } from "@/utils/vector";
import { PlayerState, defaultPlayerState } from "../types/PlayerState.types";
import { cloneDeep } from "lodash";
import { Button, ButtonConfig } from "@/ui/Button";
import { PlayerInputSchema } from "@/schemas/core/PlayerInput";
import { GamepadListener, StandardGamepadRegions } from "@/inputs/GamepadListener";
import { UIService } from "@/ui/UIService";

const CallToAction = (config: Partial<ButtonConfig>): Partial<ButtonConfig> => ({
  style: {
    borderColor: "pink",
    backgroundColor: "green",
    textTransform: "uppercase",
  },
  fontSize: 32,
  ...config,
});

const nanoid = customAlphabet("234579ACDEFGHJKMNPQRTWXYZ", 5);

export class BallLobbyScene extends Scene {
  static sceneName = "BallLobby";

  timestep: SceneTimestep = "continuous";
  dt = 4;
  paused = false;
  mouseManager: MouseManager;
  gameCanvasContext: CanvasRenderingContext2D;

  connection: ConnectionInstance<PlayerState>;

  hosting = false;

  unlisteners: (() => void)[] = [];

  players: {
    [key: string]: PlayerState;
  } = {};

  unsub: () => void;
  nickname: any;

  playerSprites: { [key: string]: string } = {};
  instance: GameInstance<PlayerState>;
  selectedCharacter: string = "";
  unsubPlayerConnect: () => void;
  startingGame: boolean;
  resizeListener: () => void;
  shownWeapon: string;
  shownCharacter: string;

  public initialize = async (args: any[]): Promise<void> => {
    console.log(args);
    if (args.length) {
      this.instance = args[0].instance;
      this.players = {};
      this.connection = this.instance.options.connection;
    }

    this.resizeListener = () => {
      this.renderUi();
    };
    window.addEventListener("resize", this.resizeListener);

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
      this.connection = new PeerMultiplayerInstance(
        {
          name: nanoid(),
          token: "",
          id: nanoid(),
          config: cloneDeep(defaultPlayerState),
        },
        inputManager,
        new MouseManager(),
        {
          solohost: true,
          prefix: "group-chat-",
          address: lobbyId,
          //"abcd",
        }
      );

      this.unsubPlayerConnect = this.connection.onPlayerConnect((playerConnect) => {
        if (playerConnect.config) {
          this.players[playerConnect.id] = playerConnect.config;
        }

        if (playerConnect.config) {
          this.players[playerConnect.id] = playerConnect.config;
          if (!this.startingGame && Object.values(this.players).every((p) => p.ready)) {
            const isHosting = Object.keys(this.players).sort()[0] === this.connection.playerId;
            this.startGame(isHosting);
          } else {
            this.renderUi();
          }
        }
      });

      await this.attemptConnect(lobbyId);
    } else {
      this.unsubPlayerConnect = this.connection.onPlayerConnect((playerConnect) => {
        if (playerConnect.config) {
          this.players[playerConnect.id] = playerConnect.config;
        }

        if (playerConnect.config) {
          this.players[playerConnect.id] = playerConnect.config;
          if (!this.startingGame && Object.values(this.players).every((p) => p.ready)) {
            const isHosting = Object.keys(this.players).sort()[0] === this.connection.playerId;
            this.startGame(isHosting);
          } else {
            this.renderUi();
          }
        }
      });
      this.connection.updatePlayerConnect({
        config: cloneDeep(defaultPlayerState),
      });
    }
    this.ui.background = new Box(new Position("full", "full"), {
      style: {
        background: "linear-gradient(to bottom, #666, #333)",
        zIndex: "-3",
      },
    });

    this.renderUi();
  };

  renderUi = () => {
    this.renderActions();
  };

  renderActions = () => {
    this.ui.start = new Button(
      new Position(50, "center", {
        width: 300,
        height: 100,
        yOffset: 150,
      }),
      CallToAction({
        label: "Ready",
        onClick: () => {
          UIService.getInstance().playSound("ding");
          this.connection.updatePlayerConnect({
            config: {
              ...this.connection.player.config!,
              ready: !this.connection.player.config!.ready,
            },
          });
        },
      })
    );
  };

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
      gameName: "Project V",
      connection: this.connection,
      uiService: true,
      buildWorld: (gameModel: GameModel, firstPlayerConfig: PlayerState) => {
        const zero_zero = gameModel.addEntity();
        gameModel.setComponent(zero_zero, "Transform", {
          x: 0,
          y: 0,
        });
        gameModel.setComponent(zero_zero, "Radius", { radius: 10 });
      },
      onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: PlayerState & { name: string }) => {
        const player = EntityFactory.getInstance().generateEntity(gameModel, "ball");

        gameModel.logEntity(player, true);

        const PlayerInput = gameModel.getTyped(player, PlayerInputSchema);
        PlayerInput.keyMap = this.connection.inputManager.buildKeyMap();
        PlayerInput.id = playerId;
        PlayerInput.name = playerConfig.name;

        const index = gameModel.players.length - 1;
        const angle = (index * Math.PI * 2) / 3;
        TransformSchema.position = rotateVector2d(
          {
            x: 0,
            y: 200,
          },
          angle
        );

        return player;
      },
      onPlayerLeave: (gameModel: GameModel, playerId: string) => {
        const players = gameModel.getComponentActives("PlayerInput");
        const player = players.find((p) => {
          const PlayerInput = gameModel.getTyped(p, PlayerInputSchema);
          return PlayerInput.id === playerId;
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
    console.log(this.hosting, lobbyId);

    if (!this.hosting) {
      try {
        await this.connection.connect(lobbyId);
      } catch (e) {
        console.error(e);
        this.ui.chatBox.config.label = "Failed to connect";
        this.ui.initLobby.visible = true;
        return;
      }
    }
  }

  handleMessage = (message: string, self: boolean) => {
    console.log(message);
    if (message.startsWith("/")) {
      const parts = message.substring(1).split(" ");
      switch (parts[0]) {
        case "start":
          this.changeScene("BallGame", {
            instance: this.instance,
            hosting: false,
            wave: 1,
          });
          break;
      }
      return;
    }
    const label = this.ui.chatBox.config.label + "\n" + (self ? "You: " + message : "Thm: " + message);
    if (label.split("\n").length > 3) {
      this.ui.chatBox.config.label = label.split("\n").slice(1).join("\n");
    } else {
      this.ui.chatBox.config.label = label;
    }
  };

  run = () => {};

  public destroy = (): void => {
    super.destroy();
    this.unsub?.();
    this.unlisteners.forEach((unlistener) => unlistener());
    this.unsubPlayerConnect();
    window.removeEventListener("resize", this.resizeListener);
    console.log("this is the lobby scene");
    console.log("MinMediator: destroy!");
  };
}
