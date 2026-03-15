import { InputManager, InputEventType } from "yage/inputs/InputManager";
import { CoreConnectionInstance } from "./CoreConnectionInstance";
import type { GameModel } from "yage/game/GameModel";
import type { PlayerConnection } from "./ConnectionInstance";

/**
 * E2EConnectionInstance is a specialized connection instance for headless E2E testing.
 * It extends CoreConnectionInstance but overrides behavior so that inputs are not polled
 * from the DOM, but instead queued deterministically by the E2EBridge.
 *
 * Multiple simulated players can be joined programmatically, each with their own
 * isolated input channel (combineKeyMaps = false).
 */
export class E2EConnectionInstance<T> extends CoreConnectionInstance<T> {
  private playerInputIndices: Map<string, number> = new Map();
  private nextInputIndex = 0;

  override get player(): PlayerConnection<T> {
    return this.localPlayers[0];
  }

  constructor(
    public inputManager: InputManager,
    config?: T,
  ) {
    super(
      {
        netId: "e2e_host",
        uniqueId: "e2e_host",
        token: "e2e_host",
        inputType: InputEventType.KEYBOARD,
        inputIndex: 0,
        config,
      },
      inputManager,
      { roomPersist: false },
    );
    this.inputManager.combineKeyMaps = false;
  }

  emit(event: string, ...args: any[]) {
    if (event !== "message") {
      if (this.onceSubscriptions[event]) {
        this.onceSubscriptions[event].forEach((callback) => {
          callback(this.player.netId, ...args);
        });
        this.onceSubscriptions[event] = [];
      }
      if (this.subscriptions[event]) {
        this.subscriptions[event].forEach((callback) => {
          callback(this.player.netId, ...args);
        });
      }
    }
  }

  async connect(): Promise<void> {
    super.connect();
    this.player.connected = true;
    this.player.connectionTime = Date.now();
    this.roomSyncResolve();
    this.emit("connect", this.player);
  }

  /**
   * Programmatically join a simulated player into the active room.
   * Returns the inputIndex assigned to this player (used for input dispatch).
   */
  public joinSimulatedPlayer(pid: string, config: any): number {
    const inputIndex = this.nextInputIndex++;
    this.playerInputIndices.set(pid, inputIndex);

    const playerConn: PlayerConnection<T> = {
      netId: pid,
      uniqueId: pid,
      token: pid,
      inputType: InputEventType.KEYBOARD,
      inputIndex: inputIndex,
      config: config,
      connected: true,
      connectionTime: Date.now(),
      currentRoomId: null,
      roomsSynced: true,
      hostedRooms: [],
    };

    this.localPlayers.push(playerConn);
    this.players.push(playerConn);

    // If we have an active room, inject the player into the game model
    const roomIds = Object.keys(this.roomStates);
    if (roomIds.length > 0) {
      const roomId = roomIds[0];
      playerConn.currentRoomId = roomId;
      const roomState = this.roomStates[roomId];
      if (roomState && roomState.gameModel) {
        this.createPlayer(roomState.gameModel, pid, config, roomState.gameModel.frame);
        roomState.gameModel.localNetIds.push(pid);
        roomState.gameModel.localNetIds = roomState.gameModel.localNetIds.sort();
      }
    }

    return inputIndex;
  }

  /**
   * Get the input index for a specific player (used by the bridge for input dispatch).
   */
  public getPlayerInputIndex(pid: string): number {
    const index = this.playerInputIndices.get(pid);
    if (index === undefined) {
      throw new Error(`Player '${pid}' has not joined the E2E session`);
    }
    return index;
  }

  /**
   * Get all joined player IDs.
   */
  public getJoinedPlayerIds(): string[] {
    return Array.from(this.playerInputIndices.keys());
  }
}
