import { InputManager, InputEventType } from "yage/inputs/InputManager";
import { KeyboardListener } from "yage/inputs/KeyboardListener";
import AssetLoader from "yage/loader/AssetLoader";
import { UIService } from "yage/ui/UIService";
import { buildUiMap, type UiMap } from "yage/ui/UiMap";
import type { UIElement } from "yage/ui/UIElement";
import { isSyntheticMouseEvent, markTouchInteraction } from "yage/inputs/TouchMouseGuard";
import { InputClusterer } from "./InputClusterer";
import { ensureMobileFullscreenButton } from "yage/game/mobileFullscreen";
import { PeerMultiplayerInstance, type PeerMultiplayerInstanceOptions } from "yage/connection/PeerMultiplayerInstance";
import type { PlayerConnect } from "yage/connection/ConnectionInstance";
import { PeerRoomDiscovery } from "./PeerRoomDiscovery";
import type {
  UmilStep,
  UmilConfig,
  UmilResult,
  UMIL_LocalPlayerConfig,
  UMIL_RoomData,
  UMIL_LobbyState,
  UMIL_LobbyPlayer,
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
  private joinRoomCode: string = "";

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
  private peerDiscovery: PeerRoomDiscovery | null = null;
  private peerRoomConnection: PeerMultiplayerInstance<T> | null = null;
  private peerRoomListenersBound: boolean = false;
  private readonly peerNetId: string = `umil-${nanoid()}`;

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
    this.uiService.playerInputs = [[InputEventType.ANY, 0]];
    ensureMobileFullscreenButton();
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
      if (isSyntheticMouseEvent()) {
        return;
      }
      this.inputManager.dispatchEvent("click", true, InputEventType.MOUSE, 0, e);
      setTimeout(() => this.inputManager.dispatchEvent("click", false, InputEventType.MOUSE, 0), 100);
    };
    document.addEventListener("mousedown", this.mouseHandler);

    // Dispatch touch events to InputManager
    this.touchHandler = (e: TouchEvent) => {
      markTouchInteraction();
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
    if (this.isPeerMultiplayerConfig(this.multiplayerConfig)) {
      void this.connectPeerDiscovery();
    }
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

  private isPeerMultiplayerConfig(config: any): config is PeerMultiplayerInstanceOptions<T> {
    return !!config?.prefix;
  }

  private getPeerLobbyId(): string {
    const version = (this.config.appVersion ?? "1").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    const appName = this.config.appName.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    return `${appName}-${version}-lobby`;
  }

  private async showHostDialog(): Promise<void> {
    this.roomId = nanoid();
    this.isHost = true;
    this.joinRoomCode = this.roomId;

    if (this.isPeerMultiplayerConfig(this.multiplayerConfig)) {
      await this.connectPeerDiscovery();
      await this.connectPeerRoom(this.roomId);
      this.showLobby(`${this.nickname}'s Room`);
      this.publishHostedRoom();
      this.broadcastLobbyState();
      return;
    }

    this.showLobby(`${this.nickname}'s Room`);
  }

  private showRoomBrowser(): void {
    this.step = "BROWSING";
    if (this.isPeerMultiplayerConfig(this.multiplayerConfig)) {
      void this.connectPeerDiscovery();
    } else {
      this.roomList = [];
    }

    this.renderRoomBrowser();
  }

  private renderRoomBrowser(): void {
    this.syncUi();
  }

  private async joinRoom(roomId: string): Promise<void> {
    this.roomId = roomId;
    this.isHost = false;

    if (this.isPeerMultiplayerConfig(this.multiplayerConfig)) {
      this.joinRoomCode = roomId;
      await this.connectPeerRoom(roomId);
      const room = this.roomList.find((entry) => entry.roomId === roomId);
      this.showLobby(room?.roomName ?? "Joined Room");
      this.emitPeerPlayerUpdate();
      return;
    }

    this.showLobby("Joined Room");
  }

  private showLobby(roomName: string): void {
    this.step = "LOBBY";

    this.lobbyState = this.lobbyState ?? {
      roomName,
      maxPlayers: this.config.maxOnlinePlayers ?? 4,
      players: [
        {
          netId: this.isPeerMultiplayerConfig(this.multiplayerConfig) ? this.peerNetId : "local",
          name: this.nickname,
          isHost: this.isHost,
          isReady: this.isReady,
        },
      ],
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
    const result: UmilResult<T> = {
      connection: this.multiplayerConfig?.prefix ? "PEER" : "SOCKET",
      localPlayers: this.localPlayers,
      nickname: this.nickname,
      roomId: this.roomId!,
      isHost: this.isHost,
      signalingServerUrl: this.config.signalingServerUrl,
      connectionInstance: this.peerRoomConnection ?? undefined,
    };
    this.complete(result);
  }

  private complete(result: UmilResult<T>): void {
    this.cleanup(Boolean(result.connectionInstance));
    if (this.resolvePromise) {
      this.resolvePromise(result);
    }
  }

  private cleanup(preservePeerRoomConnection = false): void {
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
    this.destroyPeerDiscoveryConnection();
    if (!preservePeerRoomConnection) {
      this.destroyPeerRoomConnection();
    }
  }

  private destroyPeerDiscoveryConnection(): void {
    if (!this.peerDiscovery) {
      return;
    }
    this.peerDiscovery.stop();
    this.peerDiscovery = null;
  }

  private destroyPeerRoomConnection(): void {
    if (!this.peerRoomConnection) {
      return;
    }
    const connection = this.peerRoomConnection;
    this.peerRoomConnection = null;
    this.peerRoomListenersBound = false;
    connection.peer.destroy();
  }

  private publishHostedRoom(): void {
    if (!this.peerDiscovery || !this.roomId || !this.lobbyState || !this.isHost) {
      return;
    }
    this.peerDiscovery.publishRoom({
      roomId: this.roomId,
      roomName: this.lobbyState.roomName,
      hostName: this.nickname,
      currentPlayers: this.lobbyState.players.length,
      maxPlayers: this.lobbyState.maxPlayers,
      ownerNetId: this.peerNetId,
    });
  }

  private unpublishHostedRoom(): void {
    if (!this.peerDiscovery || !this.roomId) {
      return;
    }
    this.peerDiscovery.unpublishRoom(this.roomId);
  }

  private buildPeerPlayer(): PlayerConnect<T> {
    return {
      netId: this.peerNetId,
      uniqueId: this.nickname,
      token: "",
      config: this.playerConfig,
    };
  }

  private async connectPeerDiscovery(): Promise<void> {
    if (!this.isPeerMultiplayerConfig(this.multiplayerConfig)) {
      return;
    }
    const lobbyId = this.getPeerLobbyId();
    if (this.peerDiscovery) {
      return;
    }

    this.destroyPeerDiscoveryConnection();
    this.peerDiscovery = new PeerRoomDiscovery({
      prefix: this.multiplayerConfig.prefix,
      host: this.multiplayerConfig.host,
      lobbyId,
      onRoomsChanged: (rooms) => {
        this.roomList = rooms;
        this.syncUi();
      },
    });
    await this.peerDiscovery.start();
    this.roomList = this.peerDiscovery.getRooms();
    this.syncUi();
  }

  private async connectPeerRoom(roomId: string): Promise<void> {
    if (!this.isPeerMultiplayerConfig(this.multiplayerConfig)) {
      return;
    }
    if (this.peerRoomConnection?.address === roomId) {
      return;
    }

    this.destroyPeerRoomConnection();
    this.peerRoomConnection = new PeerMultiplayerInstance<T>(this.buildPeerPlayer(), new InputManager(false), {
      ...this.multiplayerConfig,
      address: roomId,
    });
    this.bindPeerRoomListeners(this.peerRoomConnection);
    await this.peerRoomConnection.connect();
  }

  private bindPeerRoomListeners(connection: PeerMultiplayerInstance<T>): void {
    if (this.peerRoomListenersBound) {
      return;
    }
    this.peerRoomListenersBound = true;

    connection.on(UMIL_EVENTS.LOBBY_STATE, (_playerId, lobbyState: UMIL_LobbyState) => {
      this.lobbyState = lobbyState;
      const localPlayer = this.lobbyState.players.find((player) => player.netId === this.peerNetId);
      this.isHost = !!localPlayer?.isHost;
      this.isReady = !!localPlayer?.isReady;
      this.syncUi();
    });

    connection.on(UMIL_EVENTS.CHAT_MESSAGE, (_playerId, message: UMIL_ChatMessage) => {
      this.chatMessages = [...this.chatMessages, message];
      this.syncUi();
    });

    connection.on(UMIL_EVENTS.PLAYER_UPDATE, (playerId, update: Partial<UMIL_LobbyPlayer>) => {
      if (!this.isHost || !this.lobbyState) {
        return;
      }
      const player = this.lobbyState.players.find((entry) => entry.netId === playerId);
      if (!player) {
        return;
      }
      Object.assign(player, update);
      this.broadcastLobbyState();
    });

    connection.on(UMIL_EVENTS.START_GAME, () => {
      if (!this.isHost) {
        this.startOnlineGame();
      }
    });

    connection.onPlayerConnect((player) => {
      if (!this.isHost || !this.lobbyState) {
        return;
      }
      const existing = this.lobbyState.players.find((entry) => entry.netId === player.netId);
      if (!existing) {
        this.lobbyState.players.push({
          netId: player.netId,
          name: player.uniqueId,
          isHost: false,
          isReady: false,
        });
      }
      this.broadcastLobbyState();
    });

    connection.onPlayerDisconnect((playerId) => {
      if (!this.isHost || !this.lobbyState) {
        return;
      }
      this.lobbyState.players = this.lobbyState.players.filter((player) => player.netId !== playerId);
      this.broadcastLobbyState();
    });
  }

  private broadcastLobbyState(): void {
    if (!this.peerRoomConnection || !this.lobbyState) {
      return;
    }
    this.lobbyState = {
      ...this.lobbyState,
      players: [...this.lobbyState.players].sort((a, b) => {
        if (a.isHost) return -1;
        if (b.isHost) return 1;
        return a.name.localeCompare(b.name);
      }),
    };
    this.peerRoomConnection.emit(UMIL_EVENTS.LOBBY_STATE, this.lobbyState);
    if (this.isHost) {
      this.publishHostedRoom();
    }
    this.syncUi();
  }

  private emitPeerPlayerUpdate(): void {
    if (!this.peerRoomConnection) {
      return;
    }
    this.peerRoomConnection.updatePlayerConnect({ name: this.nickname });
    this.peerRoomConnection.emit(UMIL_EVENTS.PLAYER_UPDATE, {
      name: this.nickname,
      isReady: this.isReady,
    });
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
        void this.showHostDialog();
        return;
      case "showRoomBrowser":
        this.showRoomBrowser();
        return;
      case "showMainMenu":
      case "leaveRoom":
        this.unpublishHostedRoom();
        this.roomId = null;
        this.lobbyState = null;
        this.isHost = false;
        this.isReady = false;
        this.chatDraft = "";
        this.chatMessages = [];
        this.showMainMenu();
        return;
      case "refreshRooms":
        if (this.isPeerMultiplayerConfig(this.multiplayerConfig)) {
          this.roomList = [];
          this.destroyPeerDiscoveryConnection();
          void this.connectPeerDiscovery();
        }
        this.renderRoomBrowser();
        return;
      case "joinRoom":
        if (eventContext?.roomId) {
          void this.joinRoom(eventContext.roomId);
        }
        return;
      case "joinRoomCodeChange":
        this.joinRoomCode = typeof payload === "string" ? payload.trim().toUpperCase() : this.joinRoomCode;
        this.syncUi();
        return;
      case "submitJoinRoomCode":
        if (this.joinRoomCode) {
          void this.joinRoom(this.joinRoomCode);
        }
        return;
      case "startOnlineGame":
        this.unpublishHostedRoom();
        if (this.isPeerMultiplayerConfig(this.multiplayerConfig) && this.peerRoomConnection) {
          if (this.isHost && this.roomId && this.lobbyState) {
            const roomUpdate = {
              roomId: this.roomId,
              host: this.peerNetId,
              players: this.lobbyState.players.map((player) => player.netId),
              rebalanceOnLeave: false,
            };
            Object.values(this.peerRoomConnection.connections).forEach((conn) => {
              conn.send([this.peerNetId, "updateRoom", roomUpdate]);
            });
          }
          this.peerRoomConnection.emit(UMIL_EVENTS.START_GAME, { roomId: this.roomId });
        }
        this.startOnlineGame();
        return;
      case "toggleReady": {
        this.isReady = !this.isReady;
        const localPlayer = this.lobbyState?.players.find((player) => player.netId === this.peerNetId || player.netId === "local");
        if (localPlayer) {
          localPlayer.isReady = this.isReady;
        }
        if (this.isPeerMultiplayerConfig(this.multiplayerConfig) && this.peerRoomConnection) {
          if (this.isHost) {
            this.broadcastLobbyState();
          } else {
            this.emitPeerPlayerUpdate();
          }
        }
        this.syncUi();
        return;
      }
      case "nicknameChange":
        if (typeof payload === "string" && payload.trim()) {
          this.nickname = payload.trim();
          if (this.isHost && this.step === "LOBBY") {
            if (this.lobbyState) {
              this.lobbyState.roomName = `${this.nickname}'s Room`;
              const localPlayer = this.lobbyState.players.find(
                (player) => player.netId === this.peerNetId || player.netId === "local"
              );
              if (localPlayer) {
                localPlayer.name = this.nickname;
              }
            }
            this.publishHostedRoom();
          }
          if (this.isPeerMultiplayerConfig(this.multiplayerConfig) && this.peerRoomConnection && !this.isHost) {
            this.emitPeerPlayerUpdate();
          }
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
    if (this.isPeerMultiplayerConfig(this.multiplayerConfig) && this.peerRoomConnection) {
      this.peerRoomConnection.emit(UMIL_EVENTS.CHAT_MESSAGE, {
        senderId: this.peerNetId,
        senderName: this.nickname,
        text: nextMessage,
        timestamp: Date.now(),
      });
      this.chatDraft = "";
      this.syncUi();
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
      isPeerLobby: this.isPeerMultiplayerConfig(this.multiplayerConfig),
      joinRoomCode: this.joinRoomCode,
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
    };
  }
}
