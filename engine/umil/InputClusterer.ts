import { InputEventType, type InputManager } from "yage/inputs/InputManager";
import {
  KEYBOARD_CLUSTERS,
  EXPLICIT_JOIN_KEYS,
  EXPLICIT_LEAVE_KEYS,
  UmilInputType,
  type UmilKeyboardCluster,
  type UMIL_LocalPlayerConfig,
} from "./types";

/**
 * Gamepad button indices used for explicit join/leave.
 * 0 = A button (join), 1 = B button (leave).
 */
const GAMEPAD_JOIN_BUTTON = "0";
const GAMEPAD_LEAVE_BUTTON = "1";

export class InputClusterer {
  private assignedInputs: Map<string, number> = new Map();
  private players: UMIL_LocalPlayerConfig[] = [];
  private maxLocalPlayers: number;
  private inputManager: InputManager;
  private unsubscribe: (() => void) | null = null;
  private onPlayerJoin: ((config: UMIL_LocalPlayerConfig) => void) | null = null;
  private onPlayerLeave: ((localIndex: number) => void) | null = null;
  private explicitMode = false;

  private mousePlayerCount = 0;
  private touchPlayerCount = 0;
  private maxSharedMousePlayers: number;
  private maxSharedTouchPlayers: number;

  constructor(
    inputManager: InputManager,
    maxLocalPlayers: number,
    onInputDetected: (config: UMIL_LocalPlayerConfig) => void,
    maxSharedMousePlayers: number = 1,
    maxSharedTouchPlayers: number = 1,
  ) {
    this.inputManager = inputManager;
    this.maxLocalPlayers = maxLocalPlayers;
    this.onPlayerJoin = onInputDetected;
    this.maxSharedMousePlayers = Math.max(1, maxSharedMousePlayers);
    this.maxSharedTouchPlayers = Math.max(1, maxSharedTouchPlayers);
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  /** Legacy start – assigns on any key press (old INPUT_DETECTION behaviour). */
  start(): void {
    this.explicitMode = false;
    this.unsubscribe = this.inputManager.addKeyListener((key, pressed, eventType, typeIndex) => {
      if (!pressed) return;
      this.handleInput(key, eventType, typeIndex);
    });
  }

  /**
   * New explicit detection mode.
   * Only explicit join keys (Space / Enter / Gamepad A) create a player.
   * Escape / Gamepad B removes the player bound to that device.
   */
  startExplicitDetection(
    maxPlayers: number,
    onJoin: (config: UMIL_LocalPlayerConfig) => void,
    onLeave: (localIndex: number) => void,
  ): void {
    this.stop();
    this.reset();
    this.maxLocalPlayers = maxPlayers;
    this.onPlayerJoin = onJoin;
    this.onPlayerLeave = onLeave;
    this.explicitMode = true;

    this.unsubscribe = this.inputManager.addKeyListener((key, pressed, eventType, typeIndex) => {
      if (!pressed) return;
      this.handleExplicitInput(key, eventType, typeIndex);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  // ----------------------------------------------------------------
  // Explicit mode handler
  // ----------------------------------------------------------------

  private isJoinKey(key: string, eventType: InputEventType): boolean {
    if (eventType === InputEventType.KEYBOARD) {
      return EXPLICIT_JOIN_KEYS.includes(key.toLowerCase());
    }
    if (eventType === InputEventType.GAMEPAD) {
      return key === GAMEPAD_JOIN_BUTTON;
    }
    if (eventType === InputEventType.MOUSE) {
      return key === "click";
    }
    if (eventType === InputEventType.TOUCH) {
      return key === "tap";
    }
    return false;
  }

  private isLeaveKey(key: string, eventType: InputEventType): boolean {
    if (eventType === InputEventType.KEYBOARD) {
      return EXPLICIT_LEAVE_KEYS.includes(key.toLowerCase());
    }
    if (eventType === InputEventType.GAMEPAD) {
      return key === GAMEPAD_LEAVE_BUTTON;
    }
    return false;
  }

  private handleExplicitInput(key: string, eventType: InputEventType, typeIndex: number): void {
    // --- Leave path ---
    if (this.isLeaveKey(key, eventType)) {
      const localIndex = this.findPlayerByDevice(eventType, typeIndex, key);
      if (localIndex !== -1) {
        this.removePlayer(localIndex);
      }
      return;
    }

    // --- Join path ---
    if (!this.isJoinKey(key, eventType)) {
      return; // ignore all other keys
    }

    if (this.players.length >= this.maxLocalPlayers) {
      return; // cap reached
    }

    const deviceKey = this.buildDeviceKey(eventType, typeIndex, key);
    if (this.assignedInputs.has(deviceKey)) {
      return; // already assigned
    }

    const nextIndex = this.players.length;
    let playerConfig: UMIL_LocalPlayerConfig;

    switch (eventType) {
      case InputEventType.KEYBOARD: {
        const cluster = this.detectKeyboardCluster(key);
        if (cluster) {
          const clusterKey = `cluster_${cluster}`;
          if (this.assignedInputs.has(clusterKey)) return; // cluster already used
          this.assignedInputs.set(clusterKey, nextIndex);
        }
        playerConfig = {
          localIndex: nextIndex,
          inputType: UmilInputType.KEYBOARD,
          inputIndex: typeIndex,
          keyboardCluster: cluster,
        };
        break;
      }
      case InputEventType.GAMEPAD:
        playerConfig = {
          localIndex: nextIndex,
          inputType: UmilInputType.GAMEPAD,
          inputIndex: typeIndex,
          keyboardCluster: null,
        };
        break;
      case InputEventType.MOUSE:
        if (this.mousePlayerCount >= this.maxSharedMousePlayers) return;
        this.mousePlayerCount++;
        playerConfig = {
          localIndex: nextIndex,
          inputType: UmilInputType.MOUSE,
          inputIndex: typeIndex,
          keyboardCluster: null,
        };
        break;
      case InputEventType.TOUCH:
        if (this.touchPlayerCount >= this.maxSharedTouchPlayers) return;
        this.touchPlayerCount++;
        playerConfig = {
          localIndex: nextIndex,
          inputType: UmilInputType.TOUCH,
          inputIndex: typeIndex,
          keyboardCluster: null,
        };
        break;
      default:
        return;
    }

    this.assignedInputs.set(deviceKey, nextIndex);
    this.players.push(playerConfig);
    this.onPlayerJoin?.(playerConfig);
  }

  // ----------------------------------------------------------------
  // Legacy (any-key) mode handler – preserved for backward compat
  // ----------------------------------------------------------------

  private detectKeyboardCluster(key: string): UmilKeyboardCluster {
    const normalizedKey = key.toLowerCase();
    for (const [cluster, keys] of Object.entries(KEYBOARD_CLUSTERS)) {
      if (keys.includes(normalizedKey)) {
        return cluster as UmilKeyboardCluster;
      }
    }
    return null;
  }

  private handleInput(key: string, eventType: InputEventType, typeIndex: number): void {
    if (this.players.length >= this.maxLocalPlayers) return;

    const inputKey = `${eventType}_${typeIndex}`;
    if (this.assignedInputs.has(inputKey)) return;

    let playerConfig: UMIL_LocalPlayerConfig;

    switch (eventType) {
      case InputEventType.KEYBOARD: {
        const cluster = this.detectKeyboardCluster(key);
        if (cluster) {
          const clusterKey = `cluster_${cluster}`;
          if (this.assignedInputs.has(clusterKey)) return;
          this.assignedInputs.set(clusterKey, this.players.length);
        }
        playerConfig = {
          localIndex: this.players.length,
          inputType: UmilInputType.KEYBOARD,
          inputIndex: typeIndex,
          keyboardCluster: cluster,
        };
        break;
      }
      case InputEventType.GAMEPAD:
        playerConfig = {
          localIndex: this.players.length,
          inputType: UmilInputType.GAMEPAD,
          inputIndex: typeIndex,
          keyboardCluster: null,
        };
        break;
      case InputEventType.MOUSE:
        playerConfig = {
          localIndex: this.players.length,
          inputType: UmilInputType.MOUSE,
          inputIndex: typeIndex,
          keyboardCluster: null,
        };
        this.mousePlayerCount++;
        break;
      case InputEventType.TOUCH:
        playerConfig = {
          localIndex: this.players.length,
          inputType: UmilInputType.TOUCH,
          inputIndex: typeIndex,
          keyboardCluster: null,
        };
        this.touchPlayerCount++;
        break;
      default:
        return;
    }

    this.assignedInputs.set(inputKey, this.players.length);
    this.players.push(playerConfig);
    this.onPlayerJoin?.(playerConfig);
  }

  // ----------------------------------------------------------------
  // Remove / shared / helpers
  // ----------------------------------------------------------------

  removePlayer(localIndex: number): void {
    const player = this.players.find((p) => p.localIndex === localIndex);
    if (!player) return;

    // Remove assignment entries for this player
    for (const [key, idx] of [...this.assignedInputs.entries()]) {
      if (idx === localIndex) {
        this.assignedInputs.delete(key);
      }
    }

    if (player.inputType === UmilInputType.MOUSE) this.mousePlayerCount = Math.max(0, this.mousePlayerCount - 1);
    if (player.inputType === UmilInputType.TOUCH) this.touchPlayerCount = Math.max(0, this.touchPlayerCount - 1);

    this.players = this.players.filter((p) => p.localIndex !== localIndex);

    // Re-index remaining players and update assignment map
    this.players.forEach((p, i) => {
      p.localIndex = i;
    });
    // Rebuild assignment index values
    const rebuiltMap = new Map<string, number>();
    for (const [key, _idx] of this.assignedInputs.entries()) {
      // find the player this key belongs to by matching device info
      const ownerIndex = this.players.findIndex((p) => {
        if (key.startsWith("cluster_")) {
          return key === `cluster_${p.keyboardCluster}`;
        }
        if (key.startsWith("shared_")) {
          return key.includes(p.inputType);
        }
        return false;
      });
      if (ownerIndex >= 0) {
        rebuiltMap.set(key, ownerIndex);
      }
    }
    // Also rebuild numeric device keys
    this.players.forEach((p, i) => {
      const dKey = this.buildDeviceKeyForPlayer(p);
      if (dKey) rebuiltMap.set(dKey, i);
    });
    this.assignedInputs = rebuiltMap;

    this.onPlayerLeave?.(localIndex);
  }

  addSharedPlayer(inputType: UmilInputType, inputIndex: number): boolean {
    if (this.players.length >= this.maxLocalPlayers) return false;

    if (inputType === UmilInputType.MOUSE) {
      if (this.mousePlayerCount >= this.maxSharedMousePlayers) return false;
      this.mousePlayerCount++;
    } else if (inputType === UmilInputType.TOUCH) {
      if (this.touchPlayerCount >= this.maxSharedTouchPlayers) return false;
      this.touchPlayerCount++;
    } else {
      return false;
    }

    const nextIndex = this.players.length;
    const sharedKey = `shared_${inputType}_${nextIndex}`;
    const playerConfig: UMIL_LocalPlayerConfig = {
      localIndex: nextIndex,
      inputType,
      inputIndex,
      keyboardCluster: null,
    };

    this.assignedInputs.set(sharedKey, nextIndex);
    this.players.push(playerConfig);
    this.onPlayerJoin?.(playerConfig);
    return true;
  }

  getAssignedTypeCount(inputType: UmilInputType): number {
    if (inputType === UmilInputType.MOUSE) return this.mousePlayerCount;
    if (inputType === UmilInputType.TOUCH) return this.touchPlayerCount;

    let count = 0;
    for (const [key] of this.assignedInputs.entries()) {
      if (
        key.startsWith(`${inputType === UmilInputType.KEYBOARD ? InputEventType.KEYBOARD : InputEventType.GAMEPAD}_`)
      ) {
        count++;
      }
    }
    return count;
  }

  reset(): void {
    this.assignedInputs.clear();
    this.players = [];
    this.mousePlayerCount = 0;
    this.touchPlayerCount = 0;
  }

  getAssignedPlayerCount(): number {
    return this.players.length;
  }

  getPlayers(): UMIL_LocalPlayerConfig[] {
    return [...this.players];
  }

  getPlayerIndexForDevice(eventType: InputEventType, typeIndex: number, key: string): number {
    return this.findPlayerByDevice(eventType, typeIndex, key);
  }

  confirmInputs(): UMIL_LocalPlayerConfig[] {
    this.stop();
    return [...this.players];
  }

  // ----------------------------------------------------------------
  // Private helpers
  // ----------------------------------------------------------------

  private buildDeviceKey(eventType: InputEventType, typeIndex: number, key: string): string {
    if (eventType === InputEventType.KEYBOARD) {
      const cluster = this.detectKeyboardCluster(key);
      if (cluster) return `kb_cluster_${cluster}`;
      return `${eventType}_${typeIndex}`;
    }
    return `${eventType}_${typeIndex}`;
  }

  private buildDeviceKeyForPlayer(player: UMIL_LocalPlayerConfig): string | null {
    if (player.inputType === UmilInputType.KEYBOARD) {
      if (player.keyboardCluster) return `kb_cluster_${player.keyboardCluster}`;
      return `${InputEventType.KEYBOARD}_${player.inputIndex}`;
    }
    if (player.inputType === UmilInputType.GAMEPAD) {
      return `${InputEventType.GAMEPAD}_${player.inputIndex}`;
    }
    return null;
  }

  /** Find the local player index for a device. Returns -1 if not found. */
  private findPlayerByDevice(eventType: InputEventType, typeIndex: number, key: string): number {
    if (eventType === InputEventType.KEYBOARD) {
      // For keyboard leave, find any keyboard player (we find by cluster match or generic)
      const cluster = this.detectKeyboardCluster(key);
      if (cluster) {
        const idx = this.players.findIndex((p) => p.keyboardCluster === cluster);
        if (idx >= 0) return this.players[idx].localIndex;
      }
      // Fallback: find any keyboard player on this typeIndex
      const player = this.players.find((p) => p.inputType === UmilInputType.KEYBOARD && p.inputIndex === typeIndex);
      return player ? player.localIndex : -1;
    }
    if (eventType === InputEventType.GAMEPAD) {
      const player = this.players.find((p) => p.inputType === UmilInputType.GAMEPAD && p.inputIndex === typeIndex);
      return player ? player.localIndex : -1;
    }
    return -1;
  }
}
