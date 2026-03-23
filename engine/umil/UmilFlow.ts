import { InputManager } from "yage/inputs/InputManager";
import { KeyboardListener } from "yage/inputs/KeyboardListener";
import { UIService } from "yage/ui/UIService";
import { UiMapNext } from "yage/ui/UiMapNext";
import { Box } from "yage/ui/Box";
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
  private currentUI: any = null;

  private resolvePromise: ((result: UmilResult) => void) | null = null;
  private connection: ConnectionInstance<T> | null = null;
  private roomListPolling: ReturnType<typeof setInterval> | null = null;
  private chatUnsubscribe: (() => void) | null = null;
  private lobbyUnsubscribe: (() => void) | null = null;

  constructor(private config: UmilConfig, private playerConfig: T, private multiplayerConfig?: any) {
    this.uiService = UIService.getInstance();
    this.inputManager = new InputManager(false);
    this.keyboardListener = new KeyboardListener(this.inputManager);
    this.keyboardListener.init();

    this.inputClusterer = new InputClusterer(this.inputManager, config.maxLocalPlayers ?? 4, (config) =>
      this.onInputDetected(config)
    );

    this.rootElement = new Box(new Position("left", "top", { width: "100%", height: "100%" }), {
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
    this.updateInputDetectionUI();
  }

  private updateInputDetectionUI(): void {
    if (this.currentUI) {
const players = this.localPlayers.map((p, i) => ({
index: i + 1,
type: p.inputType,
cluster: p.keyboardCluster,
color: playerColors[i % playerColors.length],
}));
      const playerColors = ["#3498db", "#e74c3c", "#2ecc71", "#f39c12"];
players,
hasPlayers: players.length > 0,
        })),
      });
    }
  }

  private showInputDetection(): void {
    this.inputClusterer.start();

    const template = `
      <Box width="100%" height="100%" style="display: flex; flex-direction: column; align-items: center; justify-content: center; color: white;">
        <Text style="font-size: 48px; margin-bottom: 40px;">{{appName}}</Text>
        <Text style="font-size: 24px; animation: pulse 1s infinite;">Press Any Button to Join</Text>
        <Box style="margin-top: 60px; display: flex; gap: 20px;">
          {{#each players}}
            <Box style="padding: 20px; border: 2px solid {{this.color}}; border-radius: 8px; background: rgba(255,255,255,0.1);">
              <Text style="font-size: 16px;">P{{this.index}}: {{this.type}}{{#if this.cluster}} ({{this.cluster}}){{/if}}</Text>
            </Box>
          {{/each}}
        </Box>
        {{#if hasPlayers}}
          <Text style="margin-top: 40px; font-size: 16px; opacity: 0.7;">Press ENTER or START to continue</Text>
        {{/if}}
      </Box>
    `;

    this.currentUI = new UiMapNext(template);
    this.rootElement.removeAllChildren();
    this.rootElement.addChild(
      this.currentUI.build(
        {
          appName: this.config.appName,
          players: [],
          hasPlayers: false,
        },
        (playerIndex, eventName) => {
          if (eventName === "confirm") {
            this.confirmInputDetection();
          }
        }
      )
    );

    this.uiService.root.addChild(this.rootElement);

    // Listen for Enter/Start to confirm
    const checkEnter = (key: string, pressed: boolean) => {
      if (pressed && (key === "enter" || key === "start") && this.localPlayers.length > 0) {
        this.confirmInputDetection();
        return false;
      }
      return true;
    };

    this.inputManager.addKeyListener(checkEnter);
  }

  private confirmInputDetection(): void {
    this.localPlayers = this.inputClusterer.confirmInputs();
    if (this.localPlayers.length === 0) {
      // Add default mouse player if no input detected
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

    const template = `
      <Box width="100%" height="100%" style="display: flex; flex-direction: column; align-items: center; justify-content: center; color: white;">
        <Text style="font-size: 36px; margin-bottom: 40px;">{{appName}}</Text>
        <Box style="display: flex; flex-direction: column; gap: 15px; width: 300px;">
          <TextInput value="{{nickname}}" onchange="updateNickname" label="Enter nickname..."
            style="padding: 10px; font-size: 18px; border: 1px solid white; background: rgba(255,255,255,0.1); color: white;" focusable="true"/>
          {{#if allowLocal}}
            <Button onclick="localGame" style="padding: 15px; font-size: 18px; cursor: pointer;" focusable="true">Local Game</Button>
          {{/if}}
          {{#if allowOnline}}
            <Button onclick="hostGame" style="padding: 15px; font-size: 18px; cursor: pointer;" focusable="true">Host Online Game</Button>
            <Button onclick="joinGame" style="padding: 15px; font-size: 18px; cursor: pointer;" focusable="true">Join Online Game</Button>
          {{/if}}
        </Box>
      </Box>
    `;

    this.currentUI = new UiMapNext(template);
    this.rootElement.removeAllChildren();
    this.rootElement.addChild(
      this.currentUI.build(
        {
          appName: this.config.appName,
          nickname: this.nickname,
          allowLocal: this.config.allowLocalOnly !== false,
          allowOnline: this.config.allowOnline !== false,
        },
        (playerIndex, eventName, eventType, context, contextPath) => {
          if (eventName === "localGame") {
            this.nickname = context.nickname || this.nickname;
            this.startLocalGame();
          } else if (eventName === "hostGame") {
            this.nickname = context.nickname || this.nickname;
            this.showHostDialog();
          } else if (eventName === "joinGame") {
            this.nickname = context.nickname || this.nickname;
            this.showRoomBrowser();
          }
        }
      )
    );
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

    // Simulate fetching room list
    this.roomList = [
      { roomId: "room1", roomName: "Test Room 1", hostName: "Player_A", currentPlayers: 2, maxPlayers: 4 },
      { roomId: "room2", roomName: "Test Room 2", hostName: "Player_B", currentPlayers: 1, maxPlayers: 4 },
    ];

    const template = `
      <Box width="100%" height="100%" style="display: flex; flex-direction: column; align-items: center; padding: 40px; color: white;">
        <Text style="font-size: 36px; margin-bottom: 20px;">Join Online Game</Text>
        <Box style="width: 600px; max-height: 400px; overflow: auto; border: 1px solid white;">
          {{#each rooms}}
            <Box style="padding: 15px; border-bottom: 1px solid rgba(255,255,255,0.2); display: flex; justify-content: space-between; align-items: center;">
              <Box style="display: flex; flex-direction: column;">
                <Text style="font-size: 18px;">{{this.roomName}}</Text>
                <Text style="font-size: 14px; opacity: 0.7;">Host: {{this.hostName}} | {{this.currentPlayers}}/{{this.maxPlayers}} players</Text>
              </Box>
              <Button onclick="joinRoom_{{this.roomId}}" style="padding: 8px 16px;" focusable="true">Join</Button>
            </Box>
          {{else}}
            <Text style="padding: 40px; text-align: center; opacity: 0.5;">No active rooms found. Be the first to host!</Text>
          {{/each}}
        </Box>
        <Box style="margin-top: 20px; display: flex; gap: 10px;">
          <Button onclick="refresh" style="padding: 10px 20px;" focusable="true">Refresh</Button>
          <Button onclick="back" style="padding: 10px 20px;" focusable="true">Back</Button>
        </Box>
      </Box>
    `;

    this.currentUI = new UiMapNext(template);
    this.rootElement.removeAllChildren();
    this.rootElement.addChild(
      this.currentUI.build(
        {
          rooms: this.roomList,
        },
        (playerIndex, eventName) => {
          if (eventName === "back") {
            this.showMainMenu();
          } else if (eventName === "refresh") {
            // Refresh room list
            this.currentUI.update({ rooms: this.roomList });
          } else if (eventName.startsWith("joinRoom_")) {
            const roomId = eventName.replace("joinRoom_", "");
            this.joinRoom(roomId);
          }
        }
      )
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

    const template = `
      <Box width="100%" height="100%" style="display: flex; padding: 40px; color: white; gap: 20px;">
        <Box style="flex: 1; display: flex; flex-direction: column;">
          <Text style="font-size: 28px; margin-bottom: 20px;">Room: {{lobby.roomName}}</Text>
          <Text style="font-size: 14px; opacity: 0.7; margin-bottom: 20px;">Room ID: {{roomId}}</Text>
          <Text style="font-size: 20px; margin-bottom: 10px;">Players:</Text>
          <Box style="border: 1px solid white; padding: 10px; margin-bottom: 20px;">
            {{#each lobby.players}}
              <Box style="padding: 10px; display: flex; align-items: center; gap: 10px;">
                <Box style="width: 10px; height: 10px; border-radius: 50%; background: {{this.isReady ? 'green' : 'red'}};"></Box>
                <Text style="font-size: 16px;">{{this.name}} {{#if this.isHost}}(Host){{/if}}</Text>
              </Box>
            {{/each}}
          </Box>
          <Button onclick="toggleReady" style="padding: 15px; margin-bottom: 10px; background: {{isReady ? 'green' : 'transparent'}};" focusable="true">
            {{#if isReady}}Ready!{{else}}Not Ready{{/if}}
          </Button>
          {{#if isHost}}
            <Button onclick="startGame" style="padding: 15px; opacity: {{canStart ? '1' : '0.5'}};" focusable="true">Start Game</Button>
          {{/if}}
          <Button onclick="leave" style="padding: 15px; margin-top: auto;" focusable="true">Leave Room</Button>
        </Box>
        <Box style="flex: 1; display: flex; flex-direction: column; border: 1px solid white;">
          <Box style="flex: 1; overflow: auto; padding: 10px;">
            {{#each messages}}
              <Text style="font-size: 14px; margin-bottom: 4px;">{{this.senderName}}: {{this.text}}</Text>
            {{/each}}
          </Box>
          <Box style="display: flex; border-top: 1px solid white;">
            <TextInput value="{{chatInput}}" onchange="updateChat" onsubmit="sendChat"
              style="flex: 1; padding: 10px; border: none; background: rgba(255,255,255,0.1); color: white;"
              label="Type a message..." focusable="true"/>
            <Button onclick="sendChat" style="padding: 10px 20px;" focusable="true">Send</Button>
          </Box>
        </Box>
      </Box>
    `;

    let chatInput = "";

    const updateLobbyUI = () => {
      const canStart = this.isHost && this.lobbyState!.players.every((p) => p.isReady);

      this.currentUI.update({
        lobby: this.lobbyState,
        roomId: this.roomId,
        isHost: this.isHost,
        isReady: this.isReady,
        canStart,
        messages: this.chatMessages,
        chatInput,
      });
    };

    this.currentUI = new UiMapNext(template);
    this.rootElement.removeAllChildren();
    this.rootElement.addChild(
      this.currentUI.build(
        {
          lobby: this.lobbyState,
          roomId: this.roomId,
          isHost: this.isHost,
          isReady: this.isReady,
          canStart: false,
          messages: this.chatMessages,
          chatInput,
        },
        (playerIndex, eventName, eventType, context) => {
          if (eventName === "toggleReady") {
            this.isReady = !this.isReady;
            const localPlayer = this.lobbyState!.players.find((p) => p.netId === "local");
            if (localPlayer) localPlayer.isReady = this.isReady;
            updateLobbyUI();
          } else if (eventName === "startGame") {
            this.startOnlineGame();
          } else if (eventName === "leave") {
            this.showMainMenu();
          } else if (eventName === "sendChat") {
            chatInput = context.chatInput || "";
            if (chatInput.trim()) {
              this.chatMessages.push({
                senderId: "local",
                senderName: this.nickname,
                text: chatInput.trim(),
                timestamp: Date.now(),
              });
              chatInput = "";
              updateLobbyUI();
            }
          }
        }
      )
    );

    // Poll for updates
    if (this.roomListPolling) {
      clearInterval(this.roomListPolling);
    }

    this.roomListPolling = setInterval(() => {
      // Simulate receiving lobby updates
      updateLobbyUI();
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