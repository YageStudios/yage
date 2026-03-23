import { InputEventType, type InputManager } from "yage/inputs/InputManager";
import { KEYBOARD_CLUSTERS, UmilInputType, type UmilKeyboardCluster, type UMIL_LocalPlayerConfig } from "./types";

export class InputClusterer {
  private assignedInputs: Map<string, number> = new Map();
  private nextLocalIndex = 0;
  private maxLocalPlayers: number;
  private inputManager: InputManager;
  private unsubscribe: (() => void) | null = null;
  private onInputDetected: (config: UMIL_LocalPlayerConfig) => void;

  constructor(
    inputManager: InputManager,
    maxLocalPlayers: number,
    onInputDetected: (config: UMIL_LocalPlayerConfig) => void,
  ) {
    this.inputManager = inputManager;
    this.maxLocalPlayers = maxLocalPlayers;
    this.onInputDetected = onInputDetected;
  }

  start(): void {
    this.unsubscribe = this.inputManager.addKeyListener((key, pressed, eventType, typeIndex) => {
      if (!pressed) return;
      this.handleInput(key, eventType, typeIndex);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

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
    if (this.nextLocalIndex >= this.maxLocalPlayers) return;

    const inputKey = `${eventType}_${typeIndex}`;
    if (this.assignedInputs.has(inputKey)) return;

    let playerConfig: UMIL_LocalPlayerConfig;

    switch (eventType) {
      case InputEventType.KEYBOARD:
        const cluster = this.detectKeyboardCluster(key);
        if (cluster) {
          const clusterKey = `cluster_${cluster}`;
          if (this.assignedInputs.has(clusterKey)) return;
          this.assignedInputs.set(clusterKey, this.nextLocalIndex);
        }
        playerConfig = {
          localIndex: this.nextLocalIndex,
          inputType: UmilInputType.KEYBOARD,
          inputIndex: typeIndex,
          keyboardCluster: cluster,
        };
        break;

      case InputEventType.GAMEPAD:
        playerConfig = {
          localIndex: this.nextLocalIndex,
          inputType: UmilInputType.GAMEPAD,
          inputIndex: typeIndex,
          keyboardCluster: null,
        };
        break;

      case InputEventType.MOUSE:
        playerConfig = {
          localIndex: this.nextLocalIndex,
          inputType: UmilInputType.MOUSE,
          inputIndex: typeIndex,
          keyboardCluster: null,
        };
        break;

      default:
        return;
    }

    this.assignedInputs.set(inputKey, this.nextLocalIndex);
    this.nextLocalIndex++;
    this.onInputDetected(playerConfig);
  }

  reset(): void {
    this.assignedInputs.clear();
    this.nextLocalIndex = 0;
  }

  getAssignedPlayerCount(): number {
    return this.nextLocalIndex;
  }

  confirmInputs(): UMIL_LocalPlayerConfig[] {
    const configs: UMIL_LocalPlayerConfig[] = [];
    for (let i = 0; i < this.nextLocalIndex; i++) {
      const inputKey = Array.from(this.assignedInputs.entries()).find(([, index]) => index === i)?.[0];

      if (!inputKey) continue;

      const [eventTypeStr, indexStr] = inputKey.split("_");
      const eventType = parseInt(eventTypeStr, 10) as InputEventType;
      const typeIndex = parseInt(indexStr, 10);

      if (eventType === InputEventType.KEYBOARD) {
        let cluster: UmilKeyboardCluster = null;
        for (const [c, idx] of this.assignedInputs.entries()) {
          if (idx === i && c.startsWith("cluster_")) {
            cluster = c.replace("cluster_", "") as UmilKeyboardCluster;
            break;
          }
        }
        configs.push({
          localIndex: i,
          inputType: UmilInputType.KEYBOARD,
          inputIndex: typeIndex,
          keyboardCluster: cluster,
        });
      } else if (eventType === InputEventType.GAMEPAD) {
        configs.push({
          localIndex: i,
          inputType: UmilInputType.GAMEPAD,
          inputIndex: typeIndex,
          keyboardCluster: null,
        });
      } else {
        configs.push({
          localIndex: i,
          inputType: UmilInputType.MOUSE,
          inputIndex: typeIndex,
          keyboardCluster: null,
        });
      }
    }

    this.stop();
    return configs;
  }
}