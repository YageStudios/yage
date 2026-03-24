import { InputManager, InputEventType } from "yage/inputs/InputManager";
import { KeyboardListener } from "yage/inputs/KeyboardListener";
import AssetLoader from "yage/loader/AssetLoader";
import { UIService } from "yage/ui/UIService";
import { buildUiMap, type UiMap } from "yage/ui/UiMap";
import type { UIElement } from "yage/ui/UIElement";
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
import { customAlphabet } from "nanoid";

const nanoid = customAlphabet("234579ACDEFGHJKMNPQRTWXYZ", 6);

const playerColors = ["#3498db", "#e74c3c", "#2ecc71", "#f39c12"];

export class UmilFlow<T = null> {
  private static readonly UI_ASSET_KEY = "__umil_flow__";

  private step: UmilStep = "INPUT_DETECTION";
  private localPlayers: UMIL_LocalPlayerConfig[] = [];
  private nickname: string = `Player_${nanoid()}`;
  private roomList: UMIL_RoomData[] = [];
  private lobbyState: UMIL_LobbyState | null = null;
  private isHost: boolean = false;
  private roomId: string | null = null;
  private chatMessages: UMIL_ChatMessage[] = [];
  private isReady: boolean = false;
  private chatDraft: string = "";

  private inputManager: InputManager;
  private inputClusterer: InputClusterer;
  private keyboardListener: KeyboardListener;
  private uiService: UIService;
  private uiMap: UiMap | null = null;
  private rootElement: UIElement<any> | null = null;

  private resolvePromise: ((result: UmilResult) => void) | null = null;
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
  }

  async start(): Promise<UmilResult> {
    await AssetLoader.getInstance().loadUi(UmilFlow.UI_ASSET_KEY, this.config.uiAssetUrl ?? "umil/flow.json5");
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
    this.syncUi();

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
    this.syncUi();
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
    this.syncUi();
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
    this.syncUi();
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
    this.syncUi();

    if (this.roomListPolling) {
      clearInterval(this.roomListPolling);
    }

    this.roomListPolling = setInterval(() => {
      this.syncUi();
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
      this.rootElement = null;
    }
    this.uiMap = null;
  }

  private syncUi(): void {
    const template = AssetLoader.getInstance().getUi(UmilFlow.UI_ASSET_KEY);
    const context = this.getViewModel();

    if (!this.uiMap) {
      this.uiMap = buildUiMap(template);
      const elements = this.uiMap.build(
        context,
        (
          playerIndex: number,
          eventName: string,
          eventType: string,
          eventContext: any,
          payload?: unknown
        ) => {
          this.handleUiEvent(playerIndex, String(eventName), eventType, eventContext, payload);
        }
      );
      this.rootElement = Object.values(elements)[0] ?? null;
      if (this.rootElement) {
        this.uiService.root.addChild(this.rootElement);
      }
      return;
    }

    this.uiMap.update(context);
  }

  private handleUiEvent(
    _playerIndex: number,
    eventName: string,
    _eventType: string,
    eventContext: any,
    payload?: unknown
  ): void {
    switch (eventName) {
      case "addMousePlayer":
        this.inputClusterer.addSharedPlayer(UmilInputType.MOUSE, 0);
        this.syncUi();
        return;
      case "addTouchPlayer":
        this.inputClusterer.addSharedPlayer(UmilInputType.TOUCH, 0);
        this.syncUi();
        return;
      case "confirmInputDetection":
        this.confirmInputDetection();
        return;
      case "startLocalGame":
        this.startLocalGame();
        return;
      case "showHostDialog":
        this.showHostDialog();
        return;
      case "showRoomBrowser":
        this.showRoomBrowser();
        return;
      case "showMainMenu":
      case "leaveRoom":
        this.showMainMenu();
        return;
      case "refreshRooms":
        this.renderRoomBrowser();
        return;
      case "joinRoom":
        if (eventContext?.roomId) {
          this.joinRoom(eventContext.roomId);
        }
        return;
      case "toggleReady": {
        this.isReady = !this.isReady;
        const localPlayer = this.lobbyState?.players.find((player) => player.netId === "local");
        if (localPlayer) {
          localPlayer.isReady = this.isReady;
        }
        this.syncUi();
        return;
      }
      case "startOnlineGame":
        if (this.lobbyState?.players.every((player) => player.isReady)) {
          this.startOnlineGame();
        }
        return;
      case "nicknameChange":
        if (typeof payload === "string" && payload.trim()) {
          this.nickname = payload.trim();
          this.syncUi();
        }
        return;
      case "chatChange":
        this.chatDraft = typeof payload === "string" ? payload : this.chatDraft;
        return;
      case "chatSubmit":
      case "chatSend":
        this.submitChat(typeof payload === "string" ? payload : this.chatDraft);
        return;
    }
  }

  private submitChat(value: string): void {
    const nextMessage = value.trim();
    if (!nextMessage) {
      return;
    }

    this.chatMessages.push({
      senderId: "local",
      senderName: this.nickname,
      text: nextMessage,
      timestamp: Date.now(),
    });
    this.chatDraft = "";
    this.syncUi();
  }

  private getViewModel() {
    const maxSharedMouse = Math.max(1, this.config.maxSharedMousePlayers ?? 1);
    const maxSharedTouch = Math.max(1, this.config.maxSharedTouchPlayers ?? 1);
    const mouseCount = this.inputClusterer.getAssignedTypeCount(UmilInputType.MOUSE);
    const touchCount = this.inputClusterer.getAssignedTypeCount(UmilInputType.TOUCH);
    const canAddMouse = mouseCount > 0 && mouseCount < maxSharedMouse;
    const canAddTouch = touchCount > 0 && touchCount < maxSharedTouch;

    const cardWidth = 180;
    const cardGap = 20;
    const totalPlayers = this.localPlayers.length;
    const totalWidth = totalPlayers * cardWidth + Math.max(totalPlayers - 1, 0) * cardGap;
    const startX = -totalWidth / 2;

    const inputPlayers = this.localPlayers.map((player, index) => ({
      label: `P${index + 1}: ${player.inputType}${player.keyboardCluster ? ` (${player.keyboardCluster})` : ""}`,
      color: playerColors[index % playerColors.length],
      xOffset: startX + index * (cardWidth + cardGap) + cardWidth / 2,
    }));

    const sharedSurfaceActions: { action: string; label: string; yOffset: number }[] = [];
    let inputButtonOffset = 80;
    if (canAddMouse) {
      sharedSurfaceActions.push({
        action: "addMousePlayer",
        label: "+ Add another Mouse Player",
        yOffset: inputButtonOffset,
      });
      inputButtonOffset += 350;
    }
    if (canAddTouch) {
      sharedSurfaceActions.push({
        action: "addTouchPlayer",
        label: "+ Add another Touch Player",
        yOffset: inputButtonOffset,
      });
      inputButtonOffset += 50;
    }

    const showInputContinuePrompt = this.localPlayers.length > 0;
    const showInputStartButton = this.localPlayers.some(
      (player) => player.inputType === UmilInputType.MOUSE || player.inputType === UmilInputType.TOUCH
    );

    const mainMenuActions: { action: string; label: string; yOffset: number }[] = [];
    let buttonY = -20;
    if (this.config.allowLocalOnly !== false) {
      mainMenuActions.push({ action: "startLocalGame", label: "Local Game", yOffset: buttonY });
      buttonY += 60;
    }
    if (this.config.allowOnline !== false) {
      mainMenuActions.push({ action: "showHostDialog", label: "Host Online Game", yOffset: buttonY });
      buttonY += 60;
      mainMenuActions.push({ action: "showRoomBrowser", label: "Join Online Game", yOffset: buttonY });
    }

    return {
      appName: this.config.appName,
      step: this.step,
      nickname: this.nickname,
      inputPlayers,
      sharedSurfaceActions,
      showInputStartButton,
      showInputContinuePrompt,
      inputStartButtonY: inputButtonOffset + 20,
      inputContinuePromptY: inputButtonOffset + (showInputStartButton ? 80 : 20),
      mainMenuActions,
      roomId: this.roomId,
      roomList: this.roomList.map((room, index) => ({
        ...room,
        yOffset: -150 + index * 70,
      })),
      lobbyState: this.lobbyState,
      lobbyPlayers:
        this.lobbyState?.players.map((player, index) => ({
          ...player,
          readyColor: player.isReady ? "green" : "red",
          nameLabel: `${player.name}${player.isHost ? " (Host)" : ""}`,
          yOffset: index * 40,
        })) ?? [],
      isHost: this.isHost,
      readyButtonLabel: this.isReady ? "Ready!" : "Not Ready",
      readyButtonColor: this.isReady ? "green" : "transparent",
      startButtonOpacity: this.lobbyState?.players.every((player) => player.isReady) ? "1" : "0.5",
      chatMessages: this.chatMessages.map((message, index) => ({
        ...message,
        yOffset: index * 22,
      })),
      chatDraft: this.chatDraft,
      playerConfig: this.playerConfig,
      multiplayerEvents: UMIL_EVENTS,
    };
  }
}
