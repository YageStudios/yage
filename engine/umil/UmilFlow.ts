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
  UmilMode,
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

type UmilSharedSurfaceAction = { action: string; label: string };
type UmilPlayerSlot = {
  localIndex: number;
  label: string;
  color: string;
  isAssigned: boolean;
  deviceType: string;
};

export class UmilFlow<T = null> {
  private static readonly UI_ASSET_KEY = "__umil_flow__";

  private step: UmilStep = "MAIN_MENU";
  private mode: UmilMode = "LOCAL";
  private localPlayers: UMIL_LocalPlayerConfig[] = [];
  private nickname: string = `Player_${nanoid()}`;
  private roomList: UMIL_RoomData[] = [];
  private lobbyState: UMIL_LobbyState | null = null;
  private isHost: boolean = false;
  private roomId: string | null = null;
  private targetRoomId: string | null = null;
  private chatMessages: UMIL_ChatMessage[] = [];
  private isReady: boolean = false;
  private chatDraft: string = "";
  private joinRoomCode: string = "";
  private copyLinkLabel: string = "Copy Link";
  private copyLinkTimer: ReturnType<typeof setTimeout> | null = null;

  // Resolved config bounds (computed once in start())
  private minPlayersTotal = 1;
  private maxPlayersTotal = 4;
  private minLocalPlayers = 1;
  private maxLocalPlayers = 4;

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
  private navKeyUnsubscribe: (() => void) | null = null;
  private mouseHandler: ((e: MouseEvent) => void) | null = null;
  private touchHandler: ((e: TouchEvent) => void) | null = null;
  private peerDiscovery: PeerRoomDiscovery | null = null;
  private peerRoomConnection: PeerMultiplayerInstance<T> | null = null;
  private peerRoomListenersBound: boolean = false;
  private readonly peerNetId: string = `umil-${nanoid()}`;

  constructor(
    private config: UmilConfig,
    private playerConfig: T,
    private multiplayerConfig?: any,
  ) {
    this.uiService = UIService.getInstance();
    this.inputManager = new InputManager(false);
    this.keyboardListener = new KeyboardListener(this.inputManager);
    this.keyboardListener.init();

    // Resolve backward-compatible config bounds
    this.maxPlayersTotal = config.maxPlayersTotal ?? config.maxOnlinePlayers ?? 4;
    this.minPlayersTotal = Math.min(config.minPlayersTotal ?? 1, this.maxPlayersTotal);
    this.maxLocalPlayers = Math.min(config.maxLocalPlayers ?? this.maxPlayersTotal, this.maxPlayersTotal);
    this.minLocalPlayers = Math.min(config.minLocalPlayers ?? 1, this.maxLocalPlayers);

    this.inputClusterer = new InputClusterer(
      this.inputManager,
      this.maxLocalPlayers,
      (cfg) => this.onInputDetected(cfg),
      Math.max(1, config.maxSharedMousePlayers ?? 1),
      Math.max(1, config.maxSharedTouchPlayers ?? 1),
    );
  }

  async start(): Promise<UmilResult> {
    await AssetLoader.getInstance().loadUi(UmilFlow.UI_ASSET_KEY, this.config.uiAssetUrl ?? "umil/flow.json5");
    this.configureTemporaryUiInputs();
    ensureMobileFullscreenButton();
    this.bindNavigationKeys();

    // Parse ?room= deep link
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get("room");
      if (roomParam && roomParam.trim().length > 0) {
        this.targetRoomId = roomParam.trim().toUpperCase();
        this.mode = "JOIN";
      }
    }

    return new Promise((resolve) => {
      this.resolvePromise = resolve;
      if (this.targetRoomId) {
        // Deep link: skip main menu, go straight to profile
        this.showProfileSetup();
      } else {
        this.showMainMenu();
      }
    });
  }

  private onInputDetected(config: UMIL_LocalPlayerConfig): void {
    this.localPlayers = this.inputClusterer.getPlayers();
    this.syncUi();
    if (config.inputType === UmilInputType.KEYBOARD) {
      this.uiService.clearFocusedElementByPlayerIndex(0, false);
      setTimeout(() => {
        this.uiService.debouncedFocusCheck();
      }, 0);
    }
  }

  private onInputRemoved(localIndex: number): void {
    this.localPlayers = this.inputClusterer.getPlayers();
    this.syncUi();
    if (!this.localPlayers.some((player) => player.inputType === UmilInputType.KEYBOARD)) {
      this.uiService.clearFocusedElementByPlayerIndex(0, false);
    }
  }

  private showInputSetup(): void {
    this.step = "INPUT_SETUP";
    this.configureTemporaryUiInputs();
    this.localPlayers = [];
    this.inputClusterer.stop();
    this.inputClusterer.reset();
    const allowedLocalPlayers = this.getAllowedLocalPlayersForCurrentMode();

    // Use explicit detection: only Enter/Space/Gamepad A to join, Escape/Gamepad B to leave
    this.inputClusterer.startExplicitDetection(
      allowedLocalPlayers,
      (cfg) => this.onInputDetected(cfg),
      (idx) => this.onInputRemoved(idx),
    );
    this.bindNavigationKeys();

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

    this.syncUi();
  }

  private showProfileSetup(): void {
    this.bindNavigationKeys();
    this.step = "PROFILE_SETUP";
    this.configureTemporaryUiInputs();
    this.syncUi();
  }

  private configureTemporaryUiInputs(): void {
    if (this.step === "INPUT_SETUP") {
      this.uiService.playerInputs = [[InputEventType.ANY, 0]];
      this.uiService.enableKeyCapture(this.inputManager);
      return;
    }

    this.uiService.playerInputs = [[InputEventType.KEYBOARD, 0]];
    this.uiService.enableKeyCapture(this.inputManager);
  }

  private getRequiredLocalPlayersForCurrentMode(): number {
    if (this.mode === "HOST" || this.mode === "JOIN") {
      return Math.max(1, this.minLocalPlayers - 1);
    }
    return this.minLocalPlayers;
  }

  private getAllowedLocalPlayersForCurrentMode(): number {
    if (this.mode === "HOST" || this.mode === "JOIN") {
      return Math.max(1, Math.min(this.maxLocalPlayers, this.maxPlayersTotal - 1));
    }
    return this.maxLocalPlayers;
  }

  private bindNavigationKeys(): void {
    if (this.navKeyUnsubscribe) {
      this.navKeyUnsubscribe();
      this.navKeyUnsubscribe = null;
    }

    this.navKeyUnsubscribe = this.inputManager.addKeyListener((key, pressed, eventType, typeIndex) => {
      if (!pressed) {
        return;
      }

      const normalizedKey = key.toLowerCase();
      const isBackKey =
        (eventType === InputEventType.KEYBOARD && normalizedKey === "escape") ||
        (eventType === InputEventType.GAMEPAD && key === "1");

      if (!isBackKey) {
        return;
      }

      if (this.step === "PROFILE_SETUP" || this.step === "ROOM_BROWSER") {
        this.showMainMenu();
        return false;
      }

      if (this.step !== "INPUT_SETUP") {
        return;
      }

      const playerIndex = this.inputClusterer.getPlayerIndexForDevice(eventType, typeIndex, normalizedKey);
      if (playerIndex === -1) {
        this.showMainMenu();
        return false;
      }
    });
  }

  private confirmInputSetup(): void {
    this.localPlayers = this.inputClusterer.confirmInputs();
    const requiredLocalPlayers = this.getRequiredLocalPlayersForCurrentMode();

    // Ensure minimum local players requirement met
    if (this.localPlayers.length < requiredLocalPlayers) {
      // Re-start detection – don't proceed
      this.showInputSetup();
      return;
    }

    if (this.localPlayers.length === 0) {
      this.localPlayers.push({
        localIndex: 0,
        inputType: UmilInputType.MOUSE,
        inputIndex: 0,
        keyboardCluster: null,
      });
    }

    if (this.mode === "LOCAL") {
      this.startLocalGame();
    } else if (this.mode === "HOST") {
      void this.showHostDialog();
    } else if (this.mode === "JOIN") {
      void this.joinRoom(this.targetRoomId ?? this.joinRoomCode);
    }
  }

  generateRoomUrl(roomId: string): string {
    if (typeof window === "undefined") return roomId;
    return `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
  }

  private async copyRoomLink(): Promise<void> {
    if (!this.roomId) return;
    const url = this.generateRoomUrl(this.roomId);
    try {
      if (typeof window !== "undefined" && window.isSecureContext && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback: hidden textarea
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      this.copyLinkLabel = "Copied!";
      this.syncUi();
      if (this.copyLinkTimer) clearTimeout(this.copyLinkTimer);
      this.copyLinkTimer = setTimeout(() => {
        this.copyLinkLabel = "Copy Link";
        this.syncUi();
      }, 2000);
    } catch {
      // silently fail
    }
  }

  private showMainMenu(): void {
    this.bindNavigationKeys();
    this.step = "MAIN_MENU";
    this.mode = "LOCAL";
    this.targetRoomId = null;
    this.configureTemporaryUiInputs();
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
    this.bindNavigationKeys();
    this.step = "ROOM_BROWSER";
    this.configureTemporaryUiInputs();
    if (this.isPeerMultiplayerConfig(this.multiplayerConfig)) {
      void this.connectPeerDiscovery();
    } else {
      this.roomList = [];
    }

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
    this.configureTemporaryUiInputs();

    this.lobbyState = this.lobbyState ?? {
      roomName,
      maxPlayers: this.maxPlayersTotal,
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
    this.uiService.disableKeyCapture();

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

    if (this.copyLinkTimer) {
      clearTimeout(this.copyLinkTimer);
      this.copyLinkTimer = null;
    }

    if (this.chatUnsubscribe) {
      this.chatUnsubscribe();
      this.chatUnsubscribe = null;
    }

    if (this.lobbyUnsubscribe) {
      this.lobbyUnsubscribe();
      this.lobbyUnsubscribe = null;
    }

    if (this.navKeyUnsubscribe) {
      this.navKeyUnsubscribe();
      this.navKeyUnsubscribe = null;
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
        (playerIndex: number, eventName: string, eventType: string, eventContext: any, payload?: unknown) => {
          this.handleUiEvent(playerIndex, String(eventName), eventType, eventContext, payload);
        },
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
    payload?: unknown,
  ): void {
    if (this.handleInputSetupEvent(eventName, eventContext)) {
      return;
    }

    if (this.handleFlowEvent(eventName, eventContext, payload)) {
      return;
    }

    if (this.handleLobbyEvent(eventName, payload)) {
      return;
    }
  }

  private handleInputSetupEvent(eventName: string, eventContext: any): boolean {
    switch (eventName) {
      case "addMousePlayer":
        this.inputClusterer.addSharedPlayer(UmilInputType.MOUSE, 0);
        this.localPlayers = this.inputClusterer.getPlayers();
        this.syncUi();
        return true;
      case "addTouchPlayer":
        this.inputClusterer.addSharedPlayer(UmilInputType.TOUCH, 0);
        this.localPlayers = this.inputClusterer.getPlayers();
        this.syncUi();
        return true;
      case "removePlayer":
        if (typeof eventContext?.localIndex === "number") {
          this.inputClusterer.removePlayer(eventContext.localIndex);
          this.localPlayers = this.inputClusterer.getPlayers();
          this.syncUi();
        }
        return true;
      case "confirmInputSetup":
        this.confirmInputSetup();
        return true;
      default:
        return false;
    }
  }

  private handleFlowEvent(eventName: string, eventContext: any, payload?: unknown): boolean {
    switch (eventName) {
      case "selectLocal":
        this.mode = "LOCAL";
        this.showInputSetup();
        return true;
      case "selectHost":
        this.mode = "HOST";
        this.showProfileSetup();
        return true;
      case "selectJoin":
        this.mode = "JOIN";
        this.showProfileSetup();
        return true;
      case "submitProfile":
        // After profile, go to input setup (or room browser for JOIN without deep link)
        if (this.mode === "JOIN" && !this.targetRoomId) {
          this.showRoomBrowser();
        } else {
          this.showInputSetup();
        }
        return true;
      case "showMainMenu":
      case "leaveRoom":
        this.unpublishHostedRoom();
        this.roomId = null;
        this.lobbyState = null;
        this.isHost = false;
        this.isReady = false;
        this.chatDraft = "";
        this.chatMessages = [];
        this.localPlayers = [];
        this.inputClusterer.reset();
        this.showMainMenu();
        return true;
      case "backToMainMenu":
        this.showMainMenu();
        return true;
      case "refreshRooms":
        if (this.isPeerMultiplayerConfig(this.multiplayerConfig)) {
          this.roomList = [];
          this.destroyPeerDiscoveryConnection();
          void this.connectPeerDiscovery();
        }
        this.syncUi();
        return true;
      case "joinRoom":
        if (eventContext?.roomId) {
          this.targetRoomId = eventContext.roomId;
          this.showInputSetup();
        }
        return true;
      case "joinRoomCodeChange":
        this.joinRoomCode = typeof payload === "string" ? payload.trim().toUpperCase() : this.joinRoomCode;
        this.syncUi();
        return true;
      case "submitJoinRoomCode":
        if (this.joinRoomCode) {
          this.targetRoomId = this.joinRoomCode;
          this.showInputSetup();
        }
        return true;
      case "copyRoomLink":
        void this.copyRoomLink();
        return true;
      default:
        return false;
    }
  }

  private handleLobbyEvent(eventName: string, payload?: unknown): boolean {
    switch (eventName) {
      case "startOnlineGame":
        if (this.lobbyState && this.lobbyState.players.length < this.minPlayersTotal) {
          return true; // Not enough players
        }
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
        return true;
      case "toggleReady": {
        this.isReady = !this.isReady;
        const localPlayer = this.lobbyState?.players.find(
          (player) => player.netId === this.peerNetId || player.netId === "local",
        );
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
        return true;
      }
      case "nicknameChange":
        if (typeof payload === "string" && payload.trim()) {
          this.nickname = payload.trim();
          if (this.isHost && this.step === "LOBBY") {
            if (this.lobbyState) {
              this.lobbyState.roomName = `${this.nickname}'s Room`;
              const localPlayer = this.lobbyState.players.find(
                (player) => player.netId === this.peerNetId || player.netId === "local",
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
        return true;
      case "chatChange":
        this.chatDraft = typeof payload === "string" ? payload : this.chatDraft;
        return true;
      case "chatSubmit":
      case "chatSend":
        this.submitChat(typeof payload === "string" ? payload : this.chatDraft);
        return true;
      default:
        return false;
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
    const allowedLocalPlayers = this.getAllowedLocalPlayersForCurrentMode();
    const mainMenuActions: { action: string; label: string; disabled: boolean }[] = [];
    const canLocal = this.config.allowLocalOnly !== false && this.maxPlayersTotal >= this.minLocalPlayers;
    const canOnline = this.config.allowOnline !== false;
    if (canLocal) {
      mainMenuActions.push({ action: "selectLocal", label: "Play Local", disabled: false });
    }
    if (canOnline) {
      mainMenuActions.push({ action: "selectHost", label: "Host Online Game", disabled: false });
      mainMenuActions.push({ action: "selectJoin", label: "Join via Room Code", disabled: false });
    }

    const requiredLocalPlayers = this.getRequiredLocalPlayersForCurrentMode();
    const meetsMinLocal = this.localPlayers.length >= requiredLocalPlayers;
    const meetsMinTotal = this.lobbyState ? this.lobbyState.players.length >= this.minPlayersTotal : meetsMinLocal;
    const context = {
      appName: this.config.appName,
      step: this.step,
      mode: this.mode,
      nickname: this.nickname,
      isPeerLobby: this.isPeerMultiplayerConfig(this.multiplayerConfig),
      joinRoomCode: this.joinRoomCode,
      meetsMinLocal,
      meetsMinTotal,
      mainMenuActions,
      roomId: this.roomId,
      copyLinkLabel: this.copyLinkLabel,
      playerConfig: this.playerConfig,
      minPlayersTotal: this.minPlayersTotal,
      maxPlayersTotal: this.maxPlayersTotal,
      minLocalPlayers: requiredLocalPlayers,
      maxLocalPlayers: allowedLocalPlayers,
    };

    switch (this.step) {
      case "MAIN_MENU":
        return context;
      case "INPUT_SETUP":
        return {
          ...context,
          ...this.getInputSetupViewModel(allowedLocalPlayers, requiredLocalPlayers, meetsMinLocal),
        };
      case "ROOM_BROWSER":
        return {
          ...context,
          roomList: this.getRoomBrowserRooms(),
        };
      case "LOBBY":
        return {
          ...context,
          ...this.getLobbyViewModel(meetsMinTotal),
        };
      default:
        return context;
    }
  }

  private getInputSetupViewModel(allowedLocalPlayers: number, requiredLocalPlayers: number, meetsMinLocal: boolean) {
    const keyboardPlayerJoined = this.localPlayers.some((player) => player.inputType === UmilInputType.KEYBOARD);
    return {
      playerSlots: this.buildPlayerSlots(allowedLocalPlayers),
      sharedSurfaceActions: this.buildSharedSurfaceActions(allowedLocalPlayers),
      showInputContinuePrompt: meetsMinLocal,
      inputSetupContinueLabel: meetsMinLocal ? "Continue" : `Need at least ${requiredLocalPlayers} player(s)`,
      inputSetupFocusCapture: keyboardPlayerJoined ? 0 : -1,
      inputSetupContinueAutoFocus: keyboardPlayerJoined,
    };
  }

  private buildSharedSurfaceActions(allowedLocalPlayers: number): UmilSharedSurfaceAction[] {
    const maxSharedMouse = Math.max(1, this.config.maxSharedMousePlayers ?? 1);
    const maxSharedTouch = Math.max(1, this.config.maxSharedTouchPlayers ?? 1);
    const mouseCount = this.inputClusterer.getAssignedTypeCount(UmilInputType.MOUSE);
    const touchCount = this.inputClusterer.getAssignedTypeCount(UmilInputType.TOUCH);
    const canAddMouse = mouseCount > 0 && mouseCount < maxSharedMouse && this.localPlayers.length < allowedLocalPlayers;
    const canAddTouch = touchCount > 0 && touchCount < maxSharedTouch && this.localPlayers.length < allowedLocalPlayers;
    const actions: UmilSharedSurfaceAction[] = [];

    if (canAddMouse) {
      actions.push({
        action: "addMousePlayer",
        label: "+ Add another Mouse Player",
      });
    }

    if (canAddTouch) {
      actions.push({
        action: "addTouchPlayer",
        label: "+ Add another Touch Player",
      });
    }

    return actions;
  }

  private buildPlayerSlots(allowedLocalPlayers: number): UmilPlayerSlot[] {
    const playerSlots: UmilPlayerSlot[] = [];
    for (let i = 0; i < allowedLocalPlayers; i++) {
      const player = this.localPlayers.find((p) => p.localIndex === i);
      if (player) {
        playerSlots.push({
          localIndex: i,
          label: `Player ${i + 1} - ${player.inputType}${player.keyboardCluster ? ` (${player.keyboardCluster})` : ""}`,
          color: playerColors[i % playerColors.length],
          isAssigned: true,
          deviceType: player.inputType,
        });
        continue;
      }

      playerSlots.push({
        localIndex: i,
        label: "Press ENTER, SPACE, or A to Join",
        color: "rgba(255,255,255,0.3)",
        isAssigned: false,
        deviceType: "",
      });
    }

    return playerSlots;
  }

  private getRoomBrowserRooms() {
    return this.roomList.map((room) => ({
      ...room,
      isFull: room.currentPlayers >= room.maxPlayers,
    }));
  }

  private getLobbyViewModel(meetsMinTotal: boolean) {
    const allPlayersReady = this.lobbyState?.players.every((player) => player.isReady) ?? false;

    return {
      roomUrl: this.roomId ? this.generateRoomUrl(this.roomId) : "",
      lobbyState: this.lobbyState,
      lobbyPlayers:
        this.lobbyState?.players.map((player) => ({
          ...player,
          readyColor: player.isReady ? "green" : "red",
          nameLabel: `${player.name}${player.isHost ? " (Host)" : ""}`,
        })) ?? [],
      isHost: this.isHost,
      readyButtonLabel: this.isReady ? "Ready!" : "Not Ready",
      readyButtonColor: this.isReady ? "green" : "transparent",
      startButtonOpacity: meetsMinTotal && allPlayersReady ? "1" : "0.5",
      canStartGame: meetsMinTotal && allPlayersReady,
      chatMessages: this.chatMessages.slice(-100),
      chatDraft: this.chatDraft,
    };
  }
}
