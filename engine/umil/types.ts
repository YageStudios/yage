import type { ConnectionInstance } from "yage/connection/ConnectionInstance";
import type { InputEventType } from "yage/inputs/InputManager";

export type UmilStep = "MAIN_MENU" | "PROFILE_SETUP" | "ROOM_BROWSER" | "INPUT_SETUP" | "LOBBY" | "COMPLETE";

/** @deprecated Kept for backward compatibility with old step references */
export type UmilStepLegacy = "INPUT_DETECTION" | "BROWSING";

export type UmilMode = "LOCAL" | "HOST" | "JOIN";

export enum UmilInputType {
  KEYBOARD = "KEYBOARD",
  GAMEPAD = "GAMEPAD",
  MOUSE = "MOUSE",
  TOUCH = "TOUCH",
}

export type UmilKeyboardCluster = "WASD" | "ARROWS" | "IJKL" | null;

export interface UMIL_LocalPlayerConfig {
  localIndex: number;
  inputType: UmilInputType;
  inputIndex: number;
  keyboardCluster: UmilKeyboardCluster;
}

export interface UMIL_RoomData {
  roomId: string;
  roomName: string;
  hostName: string;
  currentPlayers: number;
  maxPlayers: number;
  ownerNetId?: string;
}

export interface UMIL_LobbyPlayer {
  netId: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
}

export interface UMIL_ChatMessage {
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

export interface UMIL_LobbyState {
  roomName: string;
  maxPlayers: number;
  players: UMIL_LobbyPlayer[];
}

export interface UmilConfig {
  appName: string;
  appVersion?: string;
  uiAssetUrl?: string;

  minPlayersTotal?: number;
  maxPlayersTotal?: number;
  minLocalPlayers?: number;
  maxLocalPlayers?: number;

  /** @deprecated Use maxPlayersTotal instead. Kept for backward compatibility. */
  maxOnlinePlayers?: number;

  allowLocalOnly?: boolean;
  allowOnline?: boolean;
  signalingServerUrl?: string;
  maxSharedMousePlayers?: number;
  maxSharedTouchPlayers?: number;
}

export interface UmilResult<T = any> {
  connection: "SINGLEPLAYER" | "COOP" | "PEER" | "SOCKET";
  localPlayers: UMIL_LocalPlayerConfig[];
  nickname: string;
  roomId?: string;
  isHost?: boolean;
  signalingServerUrl?: string;
  connectionInstance?: ConnectionInstance<T>;
}

export const KEYBOARD_CLUSTERS: Record<NonNullable<UmilKeyboardCluster>, string[]> = {
  WASD: ["w", "a", "s", "d", "space", "shift", "q", "e"],
  ARROWS: ["arrowup", "arrowdown", "arrowleft", "arrowright", "enter", "control"],
  IJKL: ["i", "j", "k", "l", "u", "o"],
};

export const EXPLICIT_JOIN_KEYS = ["space", "enter"];

export const EXPLICIT_LEAVE_KEYS = ["escape"];

export const UMIL_EVENTS = {
  LOBBY_STATE: "UMIL_LOBBY_STATE",
  PLAYER_UPDATE: "UMIL_PLAYER_UPDATE",
  CHAT_MESSAGE: "UMIL_CHAT_MESSAGE",
  START_GAME: "UMIL_START_GAME",
  ROOM_LIST: "UMIL_ROOM_LIST",
} as const;
