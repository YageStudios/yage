import { InputManager } from "yage/inputs/InputManager";
import { CoreConnectionInstance } from "./CoreConnectionInstance";
import type { GameModel } from "yage/game/GameModel";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { md5 } from "yage/utils/md5";
import { detailedDiff } from "deep-object-diff";
import { cloneDeep } from "lodash";
import type { ReplayStack } from "./ConnectionInstance";

export class HistoryConnectionInstance<T> extends CoreConnectionInstance<T> {
  replayHistory: ReplayStack<T>;
  constructor(history: { [key: string]: ReplayStack<T> }) {
    super(
      {
        netId: Object.keys(history[Object.keys(history)[0]].configs)[0],
        uniqueId: Object.keys(history[Object.keys(history)[0]].configs)[0],
        token: Object.keys(history[Object.keys(history)[0]].configs)[0],
        config: history[Object.keys(history)[0]].configs[Object.keys(history[Object.keys(history)[0]].configs)[0]],
      },
      new InputManager(),
      {}
    );
    const gameModelHistory = history[Object.keys(history)[0]];
    this.player.connected = true;
    this.replayHistory = gameModelHistory;
  }
  stacked = false;

  emit = () => {};
  publishState = () => {};
  updateHistory = () => {};
  frameSkipCheck: (gameModel: GameModel) => boolean = () => false;

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
