import { InputManager } from "yage/inputs/InputManager";
import { CoreConnectionInstance } from "./CoreConnectionInstance";
import type { GameModel } from "yage/game/GameModel";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { md5 } from "yage/utils/md5";
import { detailedDiff } from "deep-object-diff";
import { cloneDeep } from "lodash";
import type { PlayerConnect, ReplayStack } from "./ConnectionInstance";
import { loadPersistedHistory, type HistoryPersistenceOptions } from "./HistoryPersistenceFlow";

type ReplayHistory<T> = { [key: string]: ReplayStack<T> };

function firstReplayRoom<T>(history: ReplayHistory<T>): string | null {
  return Object.keys(history)[0] ?? null;
}

function replayPlayer<T>(history: ReplayHistory<T>): PlayerConnect<T> | null {
  const roomId = firstReplayRoom(history);
  if (!roomId) {
    return null;
  }
  const playerId = Object.keys(history[roomId].configs)[0];
  if (!playerId) {
    return null;
  }
  return {
    netId: playerId,
    uniqueId: playerId,
    token: playerId,
    config: history[roomId].configs[playerId],
  };
}

export class HistoryConnectionInstance<T> extends CoreConnectionInstance<T> {
  replayHistory!: ReplayStack<T>;

  constructor(
    history?: ReplayHistory<T>,
    private readonly historyPersistenceOptions?: HistoryPersistenceOptions
  ) {
    const player = (history && replayPlayer(history)) ?? {
      netId: "replay-player",
      uniqueId: "replay-player",
      token: "replay-player",
      config: undefined as T | undefined,
    };
    super(
      player,
      new InputManager(),
      { historyPersistence: false }
    );
    if (history && firstReplayRoom(history)) {
      this.applyReplayHistory(history);
      this.player.connected = true;
      this.roomSyncResolve();
    }
  }
  stacked = false;

  emit = () => {};
  publishState = () => {};
  updateHistory = () => {};
  frameSkipCheck: (gameModel: GameModel) => boolean = () => false;

  async connect(): Promise<void> {
    if (!this.replayHistory) {
      this.applyReplayHistory(await loadPersistedHistory<T>(this.historyPersistenceOptions));
    }
    this.player.connected = true;
    this.player.connectionTime = Date.now();
    this.roomSyncResolve();
  }

  async roomHasPlayers(): Promise<boolean> {
    return false;
  }

  private applyReplayHistory(history: ReplayHistory<T>): void {
    const roomId = firstReplayRoom(history);
    if (!roomId) {
      throw new Error("No replay history available");
    }
    const player = replayPlayer(history);
    if (!player) {
      throw new Error("Replay history does not contain a player config");
    }
    this.history = history;
    this.replayHistory = history[roomId];
    const localPlayer = this.localPlayers[0];
    localPlayer.netId = player.netId;
    localPlayer.uniqueId = player.uniqueId;
    localPlayer.token = player.token;
    localPlayer.config = player.config;
    this.players[0] = localPlayer;
  }

  startFrame(gameModel: GameModel) {
    if (!this.stacked) {
      const players = gameModel.getComponentActives("PlayerInput");
      for (let i = 0; i < players.length; ++i) {
        const player = players[i];
        if (gameModel.hasComponent(PlayerInput, player)) {
          const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
          const netId = playerInput.pid;

          const roomState = this.roomStates[gameModel.roomId];
          roomState.frameStack[netId] = [];

          for (let j = gameModel.frame; j < this.replayHistory.frames[netId].length; ++j) {
            roomState.frameStack[netId].push({
              ...cloneDeep(this.replayHistory.frames[netId][j]),
              keys: new Map<string, boolean>(Object.entries(this.replayHistory.frames[netId][j].keys)),
            });
          }
        }
      }
      this.stacked = true;
    }
    return super.startFrame(gameModel);
  }

  loadClosestFrame(gameModel: GameModel, frame: number) {
    // find the closest snapshot
    let closestSnapshot = 0;

    Object.keys(this.replayHistory.snapshots).some((snap) => {
      const snapKey = parseInt(snap, 10);
      if (snapKey > frame) {
        return true;
      }
      closestSnapshot = snapKey;
    });

    gameModel.deserializeState(cloneDeep(this.replayHistory.snapshots[closestSnapshot]));
    this.stacked = false;
    return closestSnapshot;
  }

  firstFrame(gameModel: GameModel, _firstPlayerConfig: any): void | Promise<void> {
    return;
  }

  buildWorld(
    gameModel: GameModel,
    firstPlayerConfig: any,
    buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void | Promise<void>
  ): Promise<void> | void {
    return buildWorld(gameModel, firstPlayerConfig);
  }

  // firstFrame = async (gameModel: GameModel, firstPlayerConfig: any) => {
  //   console.log(cloneDeep(this.replayHistory.snapshots[300]));
  //   const snapshot = this.replayHistory.snapshots[300];
  //   // const serializedState = gameModel.linearSerializeState();
  //   await gameModel.deserializeState(snapshot);
  //   const serializedState = md5(JSON.stringify(snapshot));
  //   this.stacked = false;

  //   console.log(serializedState);
  // };

  endFrame(gameModel: GameModel) {
    // const stateHistoryHash = this.replayHistory.stateHashes.shift()!;
    if (this.replayHistory.stateHashes[gameModel.frame]) {
      const perf = performance.now();
      const state = gameModel.serializeState();
      const serializedState = md5(JSON.stringify(state));

      if (serializedState !== this.replayHistory.stateHashes[gameModel.frame]) {
        console.log(detailedDiff(this.replayHistory.snapshots[gameModel.frame], state));
        console.log(state);

        console.error(
          "State mismatch",
          gameModel.frame,
          this.replayHistory.stateHashes[gameModel.frame],
          serializedState
        );
        throw new Error("State mismatch");
      } else {
        console.log("State match", gameModel.frame, performance.now() - perf);
      }
    }

    // if (stateHistoryHash !== serializedState) {
    //   console.log(gameModel.frame, stateHistoryHash === serializedState, stateHistoryHash, serializedState);

    //   if (this.replayHistory.snapshots[gameModel.frame]) {
    //     const snapshot = { ...this.replayHistory.snapshots[gameModel.frame] };
    //     // const serializedState = gameModel.linearSerializeState();
    //     const clonedState = cloneDeep(gameModel.state);

    //     const serializedState = gameModel.linearSerializeState();
    //     console.log(serializedState);
    //     gameModel.linearLoadState(snapshot);
    //     // @ts-ignore
    //     delete serializedState.physics; // @ts-ignore
    //     delete snapshot.physics;

    //     console.log(detailedDiff(serializedState, snapshot));
    //     stateDiff(gameModel, gameModel.state, clonedState);
    //   }
    //   throw new Error("State mismatch");
    // }
  }
}
