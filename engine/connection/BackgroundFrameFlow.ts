import type { GameModel } from "yage/game/GameModel";
import { InputManager, type KeyMap } from "yage/inputs/InputManager";
import type { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import type { Frame, PlayerConnection, RoomState } from "./ConnectionInstance";

export type SerializedFrame = {
  keys: { [key: string]: boolean };
  frame: number;
  events?: string[];
  playerId: string;
  roomId?: string;
};

export type FrameBatchMessage = {
  roomId: string;
  frames: SerializedFrame[];
  replaceFromFrame?: number;
  background?: boolean;
};

export type BackgroundFrameFlowOptions = {
  enabled?: boolean;
  intervalMs?: number;
  targetFps?: number;
  leadFrames?: number;
  maxFramesPerBatch?: number;
  resumeFrames?: number;
  catchUpFrameBudget?: number;
};

type BackgroundFrameFlowHost = {
  frameOffset: number;
  inputManager: InputManager;
  playerEventManager: PlayerEventManager;
  localPlayers: PlayerConnection<any>[];
  roomStates: { [roomId: string]: RoomState };
  pendingMissedFrames: { [roomId: string]: { [playerId: string]: number | undefined } };
  publishedFrames: { [roomId: string]: { [playerId: string]: { [frame: number]: Frame } } };
  emit: (event: string, ...args: any[]) => void;
  requestStep: () => boolean;
};

type BackgroundCursor = {
  baseFrame: number;
  lastFrame: number;
  hiddenAt: number;
};

type LocalFrameOverride = {
  keys: KeyMap;
  events: string[];
};

const emptyKeyMap = (): KeyMap => InputManager.buildKeyMap();

function toKeyMap(inputManager: InputManager, keys: KeyMap | { [key: string]: boolean } | undefined): KeyMap {
  if (keys instanceof Map) {
    return new Map(keys);
  }
  return inputManager.toKeyMap(keys ?? {});
}

function maxFrame(frames: Frame[]): number {
  return frames.reduce((max, frame) => Math.max(max, frame.frame), -1);
}

export class BackgroundFrameFlow {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly cursors: { [roomId: string]: { [playerId: string]: BackgroundCursor | undefined } } = {};
  private catchUpRunner: ((maxSteps: number) => number) | null = null;
  private catchUpScheduled = false;
  private readonly visibilityHandler = () => this.handleVisibilityChange();

  constructor(
    private readonly host: BackgroundFrameFlowHost,
    private readonly options: BackgroundFrameFlowOptions | false | undefined
  ) {
    if (!this.enabled || typeof document === "undefined") {
      return;
    }
    document.addEventListener("visibilitychange", this.visibilityHandler);
    if (this.isHidden()) {
      this.enterBackground();
    }
  }

  dispose(): void {
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
    }
    this.clearTimer();
  }

  clearRoom(roomId: string): void {
    delete this.cursors[roomId];
  }

  setCatchUpRunner(runner: ((maxSteps: number) => number) | null): void {
    this.catchUpRunner = runner;
  }

  localFrameOverride(player: PlayerConnection<any>): LocalFrameOverride | null {
    if (!this.enabled || !this.isHidden()) {
      return null;
    }
    this.host.playerEventManager.getEvents(player.netId);
    return { keys: emptyKeyMap(), events: [] };
  }

  enqueueFrame(roomId: string, frame: SerializedFrame | Frame): boolean {
    if (!frame || typeof frame.frame !== "number" || !frame.playerId) {
      return false;
    }
    if (frame.roomId && frame.roomId !== roomId) {
      return false;
    }
    const room = this.host.roomStates[roomId];
    if (!room) {
      return false;
    }
    if (room.gameModel && frame.frame < room.gameModel.frame) {
      return false;
    }
    room.frameStack[frame.playerId] = room.frameStack[frame.playerId] ?? [];
    const isStepMode = room.gameModel?.executionMode === "step";
    const queuedFrame: Frame = {
      keys: toKeyMap(this.host.inputManager, frame.keys),
      frame: frame.frame,
      events: frame.events ?? [],
      playerId: frame.playerId,
      roomId,
    };
    if (!isStepMode) {
      const lastFrame = room.lastFrame[frame.playerId] ?? -1;
      if (lastFrame >= frame.frame) {
        return false;
      }
      room.frameStack[frame.playerId].push(queuedFrame);
    } else {
      const existingIndex = room.frameStack[frame.playerId].findIndex((queued) => queued.frame === frame.frame);
      if (existingIndex !== -1) {
        room.frameStack[frame.playerId][existingIndex] = queuedFrame;
      } else {
        room.frameStack[frame.playerId].push(queuedFrame);
        room.frameStack[frame.playerId].sort((a, b) => a.frame - b.frame);
      }
    }
    room.lastFrame[frame.playerId] = Math.max(room.lastFrame[frame.playerId] ?? -1, frame.frame);

    if (this.host.pendingMissedFrames[roomId]?.[frame.playerId] === frame.frame) {
      delete this.host.pendingMissedFrames[roomId][frame.playerId];
    }

    if (
      isStepMode &&
      !this.host.localPlayers.some((player) => player.netId === frame.playerId) &&
      frame.frame >= (room.gameModel?.frame ?? frame.frame)
    ) {
      this.host.requestStep();
    }
    return true;
  }

  enqueueFrameBatch(roomId: string, batch: FrameBatchMessage): number {
    if (!batch || batch.roomId !== roomId || !Array.isArray(batch.frames)) {
      return 0;
    }
    if (typeof batch.replaceFromFrame === "number") {
      this.replaceFutureFrames(roomId, batch);
    }
    let queued = 0;
    for (const frame of batch.frames) {
      if (this.enqueueFrame(roomId, { ...frame, roomId: frame.roomId ?? roomId })) {
        queued += 1;
      }
    }
    return queued;
  }

  private get enabled(): boolean {
    return this.options !== false && this.options?.enabled !== false;
  }

  private get intervalMs(): number {
    const options = this.options;
    return options === false ? 1000 : options?.intervalMs ?? 1000;
  }

  private get targetFps(): number {
    const options = this.options;
    return options === false ? 60 : options?.targetFps ?? 60;
  }

  private get leadFrames(): number {
    const options = this.options;
    return options === false ? 180 : options?.leadFrames ?? 180;
  }

  private get maxFramesPerBatch(): number {
    const options = this.options;
    return options === false ? 300 : options?.maxFramesPerBatch ?? 300;
  }

  private get resumeFrames(): number {
    const options = this.options;
    const fallback = Math.max(16, this.host.frameOffset * 2);
    return options === false ? fallback : options?.resumeFrames ?? fallback;
  }

  private get catchUpFrameBudget(): number {
    const options = this.options;
    return options === false ? 240 : options?.catchUpFrameBudget ?? 240;
  }

  private isHidden(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  }

  private handleVisibilityChange(): void {
    if (this.isHidden()) {
      this.enterBackground();
    } else {
      this.exitBackground();
    }
  }

  private enterBackground(): void {
    this.publishBackgroundBatches();
    this.runCatchUpChunk();
    this.scheduleTimer();
  }

  private exitBackground(): void {
    this.clearTimer();
    this.publishResumeBatches();
    this.scheduleCatchUp();
  }

  private scheduleTimer(): void {
    this.clearTimer();
    if (!this.enabled || !this.isHidden()) {
      return;
    }
    this.timer = setTimeout(() => {
      this.publishBackgroundBatches();
      this.runCatchUpChunk();
      this.scheduleTimer();
    }, this.intervalMs);
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleCatchUp(): void {
    if (!this.catchUpRunner || this.catchUpScheduled) {
      return;
    }
    this.catchUpScheduled = true;
    setTimeout(() => {
      this.catchUpScheduled = false;
      this.runCatchUpChunk();
    }, 0);
  }

  private runCatchUpChunk(): number {
    return this.catchUpRunner?.(this.catchUpFrameBudget) ?? 0;
  }

  private publishBackgroundBatches(): void {
    for (const player of this.host.localPlayers) {
      this.publishBackgroundBatch(player);
    }
  }

  private publishBackgroundBatch(player: PlayerConnection<any>): void {
    const roomId = player.currentRoomId;
    if (!roomId) {
      return;
    }
    const roomState = this.host.roomStates[roomId];
    const gameModel = roomState?.gameModel;
    if (!roomState || !gameModel || gameModel.destroyed) {
      return;
    }
    this.host.playerEventManager.getEvents(player.netId);
    const now = Date.now();
    const cursor = this.cursorFor(roomId, player.netId, roomState, gameModel, now);
    const elapsedFrames = Math.ceil(((now - cursor.hiddenAt) / 1000) * this.targetFps);
    const desiredLastFrame = cursor.baseFrame + elapsedFrames + this.leadFrames;
    this.publishIdleFrames(roomId, player.netId, cursor.lastFrame + 1, desiredLastFrame, cursor);
  }

  private cursorFor(
    roomId: string,
    playerId: string,
    roomState: RoomState,
    gameModel: GameModel,
    now: number
  ): BackgroundCursor {
    this.cursors[roomId] = this.cursors[roomId] ?? {};
    const existing = this.cursors[roomId][playerId];
    if (existing) {
      return existing;
    }
    const baseFrame = Math.max(
      roomState.lastFrame[playerId] ?? gameModel.frame + this.host.frameOffset - 1,
      gameModel.frame + this.host.frameOffset - 1
    );
    const cursor = { baseFrame, lastFrame: baseFrame, hiddenAt: now };
    this.cursors[roomId][playerId] = cursor;
    return cursor;
  }

  private publishIdleFrames(
    roomId: string,
    playerId: string,
    startFrame: number,
    desiredLastFrame: number,
    cursor?: BackgroundCursor
  ): void {
    let frame = startFrame;
    while (frame <= desiredLastFrame) {
      const count = Math.min(this.maxFramesPerBatch, desiredLastFrame - frame + 1);
      const frames = this.buildFrames(roomId, playerId, frame, count, emptyKeyMap(), []);
      this.publishBatch(roomId, frames, true);
      frame += count;
    }
    if (cursor) {
      cursor.lastFrame = Math.max(cursor.lastFrame, desiredLastFrame);
    }
  }

  private publishResumeBatches(): void {
    for (const player of this.host.localPlayers) {
      const roomId = player.currentRoomId;
      if (!roomId) {
        continue;
      }
      const roomState = this.host.roomStates[roomId];
      const gameModel = roomState?.gameModel;
      if (!roomState || !gameModel || gameModel.destroyed) {
        continue;
      }
      const resumeFrame = this.estimateResumeFrame(roomState, gameModel, player.netId);
      this.publishIdleFrames(roomId, player.netId, (roomState.lastFrame[player.netId] ?? gameModel.frame) + 1, resumeFrame - 1);
      const keyMap = this.host.inputManager.getKeyMap(player.inputType, player.inputIndex);
      const events = this.host.playerEventManager.getEvents(player.netId);
      const frames = this.buildFrames(roomId, player.netId, resumeFrame, this.resumeFrames, keyMap, events);
      this.publishBatch(roomId, frames, false, resumeFrame);
      delete this.cursors[roomId]?.[player.netId];
    }
  }

  private estimateResumeFrame(roomState: RoomState, gameModel: GameModel, playerId: string): number {
    const estimatedRemoteFrame = Object.entries(roomState.lastFrame).reduce((max, [netId, frame]) => {
      if (netId === playerId) {
        return max;
      }
      return Math.max(max, frame - this.host.frameOffset);
    }, gameModel.frame);
    return Math.max(gameModel.frame + this.host.frameOffset, estimatedRemoteFrame + this.host.frameOffset);
  }

  private buildFrames(
    roomId: string,
    playerId: string,
    startFrame: number,
    count: number,
    keyMap: KeyMap,
    events: string[]
  ): Frame[] {
    return new Array(count).fill(null).map((_, index) => ({
      keys: new Map(keyMap),
      frame: startFrame + index,
      events: index === 0 ? events : [],
      playerId,
      roomId,
    }));
  }

  private publishBatch(roomId: string, frames: Frame[], background: boolean, replaceFromFrame?: number): void {
    if (!frames.length) {
      return;
    }
    const batch: FrameBatchMessage = {
      roomId,
      frames: frames.map((frame) => ({
        keys: this.host.inputManager.keyMapToJsonObject(frame.keys as KeyMap),
        frame: frame.frame,
        events: frame.events,
        playerId: frame.playerId,
        roomId,
      })),
      background,
      replaceFromFrame,
    };
    this.enqueueFrameBatch(roomId, batch);
    this.storePublishedFrames(roomId, frames);
    this.host.emit("frameBatch", batch);
  }

  private storePublishedFrames(roomId: string, frames: Frame[]): void {
    this.host.publishedFrames[roomId] = this.host.publishedFrames[roomId] ?? {};
    for (const frame of frames) {
      this.host.publishedFrames[roomId][frame.playerId] = this.host.publishedFrames[roomId][frame.playerId] ?? {};
      this.host.publishedFrames[roomId][frame.playerId][frame.frame] = frame;
      this.prunePublishedFrames(roomId, frame.playerId, frame.frame);
    }
  }

  private prunePublishedFrames(roomId: string, playerId: string, newestFrame: number): void {
    const frames = this.host.publishedFrames[roomId]?.[playerId];
    if (!frames) {
      return;
    }
    const retention = Math.max(this.leadFrames * 2, this.maxFramesPerBatch * 2, 600);
    const pruneBeforeFrame = Math.max(0, newestFrame - retention);
    Object.keys(frames).forEach((frame) => {
      if (+frame < pruneBeforeFrame) {
        delete frames[+frame];
      }
    });
  }

  private replaceFutureFrames(roomId: string, batch: FrameBatchMessage): void {
    const roomState = this.host.roomStates[roomId];
    if (!roomState) {
      return;
    }
    const replaceFromFrame = batch.replaceFromFrame!;
    const playerIds = [...new Set(batch.frames.map((frame) => frame.playerId))];
    for (const playerId of playerIds) {
      const frames = roomState.frameStack[playerId] ?? [];
      roomState.frameStack[playerId] = frames.filter((frame) => frame.frame < replaceFromFrame);
      roomState.lastFrame[playerId] = Math.max(maxFrame(roomState.frameStack[playerId]), replaceFromFrame - 1);
    }
  }
}
