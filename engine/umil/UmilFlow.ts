import { InputManager, InputEventType } from "yage/inputs/InputManager";
import { KeyboardListener } from "yage/inputs/KeyboardListener";
import { UIService } from "yage/ui/UIService";
import { Box } from "yage/ui/Box";
import { Text } from "yage/ui/Text";
import { Button } from "yage/ui/Button";
import { TextInput } from "yage/ui/TextInput";
import { Position } from "yage/ui/Rectangle";
import { InputClusterer } from "./InputClusterer";
import type {
  UmilStep,
  UmilConfig,
  UmilResult,
  UMIL_LocalPlayerConfig,
  UMIL_RoomData,
  UMIL_LobbyState,
  UMIL_ChatMessage,
} from "./types";
import { UmilInputType, UMIL_EVENTS } from "./types";
import type { ConnectionInstance, PlayerConnect } from "yage/connection/ConnectionInstance";
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("234579ACDEFGHJKMNPQRTWXYZ", 6);

const playerColors = ["#3498db", "#e74c3c", "#2ecc71", "#f39c12"];

export class UmilFlow<T = null> {
  private step: UmilStep = "INPUT_DETECTION";
  private localPlayers: UMIL_LocalPlayerConfig[] = [];
  private nickname: string = `Player_${nanoid()}`;
  private roomList: UMIL_RoomData[] = [];
  private lobbyState: UMIL_LobbyState | null = null;
  private isHost: boolean = false;
  private roomId: string | null = null;
  private chatMessages: UMIL_ChatMessage[] = [];
  private isReady: boolean = false;

  private inputManager: InputManager;
  private inputClusterer: InputClusterer;
  private keyboardListener: KeyboardListener;
  private uiService: UIService;
  private rootElement: Box;

  private resolvePromise: ((result: UmilResult) => void) | null = null;
  private connection: ConnectionInstance<T> | null = null;
  private roomListPolling: ReturnType<typeof setInterval> | null = null;
  private chatUnsubscribe: (() => void) | null = null;
  private lobbyUnsubscribe: (() => void) | null = null;
  private mouseHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;

  constructor(private config: UmilConfig, private playerConfig: T, private multiplayerConfig?: any) {
    this.uiService = UIService.getInstance();
    this.inputManager = new InputManager(false);
    this.keyboardListener = new KeyboardListener(this.inputManager);
    this.keyboardListener.init();

    this.inputClusterer = new InputClusterer(
      this.inputManager,
      config.maxLocalPlayers ?? 4,
      (config) => this.onInputDetected(config),
      Math.max(1, config.maxSharedMousePlayers ?? 1),
      Math.max(1, config.maxSharedTouchPlayers ?? 1),
    );

    this.rootElement = new Box(new Position("full", "full"), {
      style: { backgroundColor: "rgba(0,0,0,0.9)" },
    });
  }

  async start(): Promise<UmilResult> {
    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      this.showInputDetection();
    });
  }

  private onInputDetected(config: UMIL_LocalPlayerConfig): void {
    this.localPlayers.push(config);
    this.renderInputDetection();
  }

  private showInputDetection(): void {
    this.inputClusterer.start();
    this.uiService.root.addChild(this.rootElement);
    this.renderInputDetection();

    // Dispatch mouse clicks to InputManager so InputClusterer can detect them
    this.mouseHandler = (e: MouseEvent) => {
      this.inputManager.dispatchEvent("click", true, InputEventType.MOUSE, 0, e);
      setTimeout(() => this.inputManager.dispatchEvent("click", false, InputEventType.MOUSE, 0), 100);
    };
    document.addEventListener("mousedown", this.mouseHandler);

    // Dispatch touch events to InputManager
    this.touchHandler = (e: TouchEvent) => {
      this.inputManager.dispatchEvent("tap", true, InputEventType.TOUCH, 0, e);
      setTimeout(() => this.inputManager.dispatchEvent("tap", false, InputEventType.TOUCH, 0), 100);
    };
    document.addEventListener("touchstart", this.touchHandler);

    this.inputManager.addKeyListener((key: string, pressed: boolean) => {
      if (pressed && (key === "enter" || key === "start") && this.localPlayers.length > 0) {
        this.confirmInputDetection();
        return false;
      }
      return true;
    });
  }

  private renderInputDetection(): void {
    this.rootElement.removeAllChildren();

    const maxSharedMouse = Math.max(1, this.config.maxSharedMousePlayers ?? 1);
    const maxSharedTouch = Math.max(1, this.config.maxSharedTouchPlayers ?? 1);
    const mouseCount = this.inputClusterer.getAssignedTypeCount(UmilInputType.MOUSE);
    const touchCount = this.inputClusterer.getAssignedTypeCount(UmilInputType.TOUCH);
    const canAddMouse = mouseCount > 0 && mouseCount < maxSharedMouse;
    const canAddTouch = touchCount > 0 && touchCount < maxSharedTouch;

    // Title
    this.rootElement.addChild(
      new Text(new Position("center", "center", { width: "auto", height: "auto", yOffset: -200 }), {
        label: this.config.appName,
        fontSize: 48,
      })
    );

    // Subtitle
    this.rootElement.addChild(
      new Text(new Position("center", "center", { width: "auto", height: "auto", yOffset: -120 }), {
        label: "Press Any Button to Join",
        fontSize: 24,
      })
    );

    // Player cards
    const totalPlayers = this.localPlayers.length;
    const cardWidth = 180;
    const cardGap = 20;
    const totalWidth = totalPlayers * cardWidth + (totalPlayers - 1) * cardGap;
    const startX = -totalWidth / 2;

    this.localPlayers.forEach((p, i) => {
      const color = playerColors[i % playerColors.length];
      const label = `P${i + 1}: ${p.inputType}${p.keyboardCluster ? ` (${p.keyboardCluster})` : ""}`;
      const xOff = startX + i * (cardWidth + cardGap) + cardWidth / 2;

      this.rootElement.addChild(
        new Box(new Position("center", "center", { width: cardWidth, height: 60, xOffset: xOff, yOffset: 0 }), {
          style: {
            border: `2px solid ${color}`,
            borderRadius: "8px",
            backgroundColor: "rgba(255,255,255,0.1)",
          },
          children: [
            new Text(new Position("center", "center", { width: "auto", height: "auto" }), {
              label,
              fontSize: 16,
            }),
          ],
        })
      );
    });

    // Shared surface buttons
    let buttonYOffset = 80;
    if (canAddMouse) {
      this.rootElement.addChild(
        new Button(new Position("center", "center", { width: 300, height: 40, yOffset: buttonYOffset }), {
          label: "+ Add another Mouse Player",
          fontSize: 16,
          style: {
            border: "1px solid rgba(255,255,255,0.5)",
            backgroundColor: "transparent",
            color: "white",
            cursor: "pointer",
          },
          onClick: () => {
            this.inputClusterer.addSharedPlayer(UmilInputType.MOUSE, 0);
          },
        })
      );
      buttonYOffset += 50;
    }

    if (canAddTouch) {
      this.rootElement.addChild(
        new Button(new Position("center", "center", { width: 300, height: 40, yOffset: buttonYOffset }), {
          label: "+ Add another Touch Player",
          fontSize: 16,
          style: {
            border: "1px solid rgba(255,255,255,0.5)",
            backgroundColor: "transparent",
            color: "white",
            cursor: "pointer",
          },
          onClick: () => {
            this.inputClusterer.addSharedPlayer(UmilInputType.TOUCH, 0);
          },
        })
      );
      buttonYOffset += 50;
    }

    // Continue prompt / start button
    if (this.localPlayers.length > 0) {
      const hasPointerPlayer = this.localPlayers.some(
        (p) => p.inputType === UmilInputType.MOUSE || p.inputType === UmilInputType.TOUCH
      );

      if (hasPointerPlayer) {
        this.rootElement.addChild(
          new Button(new Position("center", "center", { width: 300, height: 50, yOffset: buttonYOffset + 20 }), {
            label: "Start",
            fontSize: 20,
            style: { cursor: "pointer" },
            onClick: () => {
              this.confirmInputDetection();
            },
          })
        );
      }

      this.rootElement.addChild(
        new Text(new Position("center", "center", { width: "auto", height: "auto", yOffset: buttonYOffset + (hasPointerPlayer ? 80 : 20) }), {
          label: "Press ENTER or START to continue",
          fontSize: 16,
          style: { opacity: "0.7" },
        })
      );
    }
  }

  private confirmInputDetection(): void {
    this.localPlayers = this.inputClusterer.confirmInputs();
    if (this.localPlayers.length === 0) {
      this.localPlayers.push({
        localIndex: 0,
        inputType: UmilInputType.MOUSE,
        inputIndex: 0,
        keyboardCluster: null,
      });
    }
    this.showMainMenu();
  }

  private showMainMenu(): void {
    this.step = "MAIN_MENU";
    this.rootElement.removeAllChildren();

    // Title
    this.rootElement.addChild(
      new Text(new Position("center", "center", { width: "auto", height: "auto", yOffset: -160 }), {
        label: this.config.appName,
        fontSize: 36,
      })
    );

    // Nickname input
    this.rootElement.addChild(
      new TextInput(new Position("center", "center", { width: 300, height: 40, yOffset: -80 }), {
        label: "Enter nickname...",
        value: this.nickname,
        focusable: true,
        style: {
          padding: "10px",
          fontSize: "18px",
          border: "1px solid white",
          backgroundColor: "rgba(255,255,255,0.1)",
          color: "white",
        },
        onChange: (value: string) => {
          this.nickname = value || this.nickname;
        },
      })
    );

    let buttonY = -20;

    if (this.config.allowLocalOnly !== false) {
      this.rootElement.addChild(
        new Button(new Position("center", "center", { width: 300, height: 50, yOffset: buttonY }), {
          label: "Local Game",
          fontSize: 18,
          style: { cursor: "pointer" },
          onClick: () => {
            this.startLocalGame();
          },
        })
      );
      buttonY += 60;
    }

    if (this.config.allowOnline !== false) {
      this.rootElement.addChild(
        new Button(new Position("center", "center", { width: 300, height: 50, yOffset: buttonY }), {
          label: "Host Online Game",
          fontSize: 18,
          style: { cursor: "pointer" },
          onClick: () => {
            this.showHostDialog();
          },
        })
      );
      buttonY += 60;

      this.rootElement.addChild(
        new Button(new Position("center", "center", { width: 300, height: 50, yOffset: buttonY }), {
          label: "Join Online Game",
          fontSize: 18,
          style: { cursor: "pointer" },
          onClick: () => {
            this.showRoomBrowser();
          },
        })
      );
    }
  }

  private startLocalGame(): void {
    const result: UmilResult = {
      connection: this.localPlayers.length > 1 ? "COOP" : "SINGLEPLAYER",
      localPlayers: this.localPlayers,
      nickname: this.nickname,
    };
    this.complete(result);
  }

  private showHostDialog(): void {
    const roomName = `${this.nickname}'s Room`;
    this.roomId = nanoid();
    this.isHost = true;
    this.showLobby(roomName);
  }

  private showRoomBrowser(): void {
    this.step = "BROWSING";

    this.roomList = [
      { roomId: "room1", roomName: "Test Room 1", hostName: "Player_A", currentPlayers: 2, maxPlayers: 4 },
      { roomId: "room2", roomName: "Test Room 2", hostName: "Player_B", currentPlayers: 1, maxPlayers: 4 },
    ];

    this.renderRoomBrowser();
  }

  private renderRoomBrowser(): void {
    this.rootElement.removeAllChildren();

    // Title
    this.rootElement.addChild(
      new Text(new Position("center", "center", { width: "auto", height: "auto", yOffset: -250 }), {
        label: "Join Online Game",
        fontSize: 36,
      })
    );

    // Room list
    const roomHeight = 60;
    const listStartY = -150;

    if (this.roomList.length === 0) {
      this.rootElement.addChild(
        new Text(new Position("center", "center", { width: 600, height: "auto", yOffset: listStartY }), {
          label: "No active rooms found. Be the first to host!",
          fontSize: 16,
          style: { opacity: "0.5" },
        })
      );
    } else {
      this.roomList.forEach((room, i) => {
        const yOff = listStartY + i * (roomHeight + 10);

        const roomBox = new Box(
          new Position("center", "center", { width: 600, height: roomHeight, yOffset: yOff }),
          {
            style: {
              borderBottom: "1px solid rgba(255,255,255,0.2)",
            },
            children: [
              new Text(new Position("left", "center", { width: "auto", height: "auto", xOffset: 20 }), {
                label: room.roomName,
                fontSize: 18,
              }),
              new Text(new Position("left", "center", { width: "auto", height: "auto", xOffset: 20, yOffset: 20 }), {
                label: `Host: ${room.hostName} | ${room.currentPlayers}/${room.maxPlayers} players`,
                fontSize: 14,
                style: { opacity: "0.7" },
              }),
              new Button(new Position("right", "center", { width: 80, height: 35, xOffset: -20 }), {
                label: "Join",
                fontSize: 14,
                onClick: () => {
                  this.joinRoom(room.roomId);
                },
              }),
            ],
          }
        );

        this.rootElement.addChild(roomBox);
      });
    }

    // Bottom buttons
    this.rootElement.addChild(
      new Button(new Position("center", "center", { width: 140, height: 40, yOffset: 200, xOffset: -80 }), {
        label: "Refresh",
        fontSize: 16,
        onClick: () => {
          this.renderRoomBrowser();
        },
      })
    );

    this.rootElement.addChild(
      new Button(new Position("center", "center", { width: 140, height: 40, yOffset: 200, xOffset: 80 }), {
        label: "Back",
        fontSize: 16,
        onClick: () => {
          this.showMainMenu();
        },
      })
    );
  }

  private joinRoom(roomId: string): void {
    this.roomId = roomId;
    this.isHost = false;
    this.showLobby("Joined Room");
  }

  private showLobby(roomName: string): void {
    this.step = "LOBBY";

    this.lobbyState = {
      roomName,
      maxPlayers: this.config.maxOnlinePlayers ?? 4,
      players: [{ netId: "local", name: this.nickname, isHost: this.isHost, isReady: this.isReady }],
    };

    const renderLobby = () => {
      this.rootElement.removeAllChildren();

      // Room name
      this.rootElement.addChild(
        new Text(new Position("left", "top", { width: "auto", height: "auto", xOffset: 40, yOffset: 40 }), {
          label: `Room: ${this.lobbyState!.roomName}`,
          fontSize: 28,
        })
      );

      // Room ID
      this.rootElement.addChild(
        new Text(new Position("left", "top", { width: "auto", height: "auto", xOffset: 40, yOffset: 90 }), {
          label: `Room ID: ${this.roomId}`,
          fontSize: 14,
          style: { opacity: "0.7" },
        })
      );

      // Players label
      this.rootElement.addChild(
        new Text(new Position("left", "top", { width: "auto", height: "auto", xOffset: 40, yOffset: 130 }), {
          label: "Players:",
          fontSize: 20,
        })
      );

      // Player list
      const playersBox = new Box(
        new Position("left", "top", { width: 400, height: 200, xOffset: 40, yOffset: 170 }),
        {
          style: { border: "1px solid white", padding: "10px" },
        }
      );

      this.lobbyState!.players.forEach((p, i) => {
        const readyColor = p.isReady ? "green" : "red";
        const hostLabel = p.isHost ? " (Host)" : "";

        playersBox.addChild(
          new Box(new Position("left", "top", { width: 380, height: 30, yOffset: i * 40 }), {
            children: [
              new Box(new Position("left", "center", { width: 10, height: 10, xOffset: 10 }), {
                style: { borderRadius: "50%", backgroundColor: readyColor },
              }),
              new Text(new Position("left", "center", { width: "auto", height: "auto", xOffset: 30 }), {
                label: `${p.name}${hostLabel}`,
                fontSize: 16,
              }),
            ],
          })
        );
      });

      this.rootElement.addChild(playersBox);

      // Ready button
      this.rootElement.addChild(
        new Button(new Position("left", "top", { width: 200, height: 50, xOffset: 40, yOffset: 390 }), {
          label: this.isReady ? "Ready!" : "Not Ready",
          fontSize: 16,
          style: { backgroundColor: this.isReady ? "green" : "transparent" },
          onClick: () => {
            this.isReady = !this.isReady;
            const localPlayer = this.lobbyState!.players.find((p) => p.netId === "local");
            if (localPlayer) localPlayer.isReady = this.isReady;
            renderLobby();
          },
        })
      );

      // Start game button (host only)
      if (this.isHost) {
        const canStart = this.lobbyState!.players.every((p) => p.isReady);
        this.rootElement.addChild(
          new Button(new Position("left", "top", { width: 200, height: 50, xOffset: 40, yOffset: 450 }), {
            label: "Start Game",
            fontSize: 16,
            style: { opacity: canStart ? "1" : "0.5" },
            onClick: () => {
              if (canStart) this.startOnlineGame();
            },
          })
        );
      }

      // Leave button
      this.rootElement.addChild(
        new Button(new Position("left", "bottom", { width: 200, height: 50, xOffset: 40, yOffset: -40 }), {
          label: "Leave Room",
          fontSize: 16,
          onClick: () => {
            this.showMainMenu();
          },
        })
      );

      // Chat area
      const chatBox = new Box(
        new Position("right", "top", { width: 400, height: "auto", xOffset: -40, yOffset: 40 }),
        {
          style: { border: "1px solid white" },
        }
      );

      // Chat messages
      const messagesBox = new Box(
        new Position("left", "top", { width: 400, height: 400, xOffset: 0, yOffset: 0 }),
        {
          style: { overflow: "auto", padding: "10px" },
        }
      );

      this.chatMessages.forEach((msg, i) => {
        messagesBox.addChild(
          new Text(new Position("left", "top", { width: 380, height: "auto", yOffset: i * 22 }), {
            label: `${msg.senderName}: ${msg.text}`,
            fontSize: 14,
            style: { textAlign: "left" },
          })
        );
      });

      chatBox.addChild(messagesBox);

      // Chat input row
      chatBox.addChild(
        new TextInput(new Position("left", "top", { width: 310, height: 40, yOffset: 400 }), {
          label: "Type a message...",
          value: "",
          focusable: true,
          style: {
            padding: "10px",
            border: "none",
            backgroundColor: "rgba(255,255,255,0.1)",
            color: "white",
            borderTop: "1px solid white",
          },
          onSubmit: (value: string) => {
            if (value.trim()) {
              this.chatMessages.push({
                senderId: "local",
                senderName: this.nickname,
                text: value.trim(),
                timestamp: Date.now(),
              });
              renderLobby();
            }
          },
        })
      );

      chatBox.addChild(
        new Button(new Position("right", "top", { width: 90, height: 40, yOffset: 400 }), {
          label: "Send",
          fontSize: 14,
          style: { borderTop: "1px solid white" },
          onClick: () => {
            // send handled via TextInput onSubmit
          },
        })
      );

      this.rootElement.addChild(chatBox);
    };

    renderLobby();

    if (this.roomListPolling) {
      clearInterval(this.roomListPolling);
    }

    this.roomListPolling = setInterval(() => {
      renderLobby();
    }, 1000);
  }

  private startOnlineGame(): void {
    const result: UmilResult = {
      connection: this.multiplayerConfig?.prefix ? "PEER" : "SOCKET",
      localPlayers: this.localPlayers,
      nickname: this.nickname,
      roomId: this.roomId!,
      isHost: this.isHost,
      signalingServerUrl: this.config.signalingServerUrl,
    };
    this.complete(result);
  }

  private complete(result: UmilResult): void {
    this.cleanup();
    if (this.resolvePromise) {
      this.resolvePromise(result);
    }
  }

  private cleanup(): void {
    this.inputClusterer.stop();
    this.keyboardListener.destroy();

    if (this.mouseHandler) {
      document.removeEventListener("mousedown", this.mouseHandler);
      this.mouseHandler = null;
    }
    if (this.touchHandler) {
      document.removeEventListener("touchstart", this.touchHandler);
      this.touchHandler = null;
    }

    if (this.roomListPolling) {
      clearInterval(this.roomListPolling);
      this.roomListPolling = null;
    }

    if (this.chatUnsubscribe) {
      this.chatUnsubscribe();
      this.chatUnsubscribe = null;
    }

    if (this.lobbyUnsubscribe) {
      this.lobbyUnsubscribe();
      this.lobbyUnsubscribe = null;
    }

    if (this.rootElement) {
      this.rootElement.onDestroy();
    }
  }
}