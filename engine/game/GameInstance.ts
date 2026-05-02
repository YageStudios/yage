import type { ConnectionInstance } from "yage/connection/ConnectionInstance";
import type { GameModel } from "./GameModel";
import type { UIService } from "yage/ui/UIService";
import { flags } from "yage/console/flags";
import type { AchievementService } from "yage/achievements/AchievementService";
import Ticker from "./Ticker";
import type { SceneTimestep } from "./Scene";

export type GameInstanceOptions<T> = {
  connection: ConnectionInstance<T>;
  uiService: boolean | UIService;
  seed?: string;
  buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void;
  onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: any) => number;
  onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
  achievementService?: AchievementService;
  executionMode?: "realtime" | "step";
};

export class GameInstance<T> {
  public achievementService: AchievementService;
  protected dt = 16;

  protected ticker: Ticker;
  protected timestep: Readonly<SceneTimestep> = "fixed";
  protected targetFPS: number = 60;

  render30Fps: boolean;

  private _stepInputUnsubscribe: (() => void) | null = null;
  private _stepConnectionUnsubscribe: (() => void) | null = null;
  private _stepEventUnsubscribe: (() => void) | null = null;
  private _stepScheduled = false;

  constructor(public options: GameInstanceOptions<T>) {
    this.achievementService = options.achievementService ?? {
      registerAchievement: () => {},
      flush: async () => {},
      update: async () => {},
      getAchievements: () => [],
      unlockAchievement: () => {},
      getUnlockedAchievements: () => [],
      getAchievement: () => null,
      getAchievementProgress: () => 0,
      setAchievementProgress: () => false,
      incrementAchievementProgress: () => false,
      resetAchievementProgress: () => {},
    };
  }

  async initializeRoom(
    roomId: string,
    seed?: string,
    { players, coreOverrides }: { players?: string[]; coreOverrides?: { [key: string]: any } } = {}
  ) {
    if (!this.options.connection.localPlayers.every((player) => player.connected)) {
      throw new Error("Player not connected");
    }
    players = players ?? this.options.connection.players.map((p) => p.netId);
    for (let i = 0; i < players.length; ++i) {
      const playerConnection = this.options.connection.localPlayers.find((p) => p.netId === players[i]);
      if (playerConnection && playerConnection.currentRoomId && playerConnection.currentRoomId !== roomId) {
        this.options.connection.leaveRoom(
          playerConnection.currentRoomId,
          this.options.connection.roomStates[roomId].gameModel.frame,
          i
        );
      }
    }

    if (await this.options.connection.roomHasPlayers(roomId)) {
      await this.join(roomId, seed);
    } else {
      await this.options.connection.initialize(roomId, {
        gameInstance: this,
        players: players ?? this.options.connection.players.map((p) => p.netId),
        seed: seed ?? "NO_SEED",
        coreOverrides,
        buildWorld: this.options.buildWorld,
        onPlayerJoin: this.options.onPlayerJoin,
        onPlayerLeave: this.options.onPlayerLeave,
      });
    }

    if (this.ticker) {
      this.ticker.stop();
    }

    if (this._stepInputUnsubscribe) {
      this._stepInputUnsubscribe();
      this._stepInputUnsubscribe = null;
    }
    if (this._stepConnectionUnsubscribe) {
      this._stepConnectionUnsubscribe();
      this._stepConnectionUnsubscribe = null;
    }
    if (this._stepEventUnsubscribe) {
      this._stepEventUnsubscribe();
      this._stepEventUnsubscribe = null;
    }

    const executionMode = this.options.executionMode ?? "realtime";

    // Propagate executionMode to all active game models
    for (const rid of Object.keys(this.options.connection.roomStates)) {
      const gm = this.options.connection.roomStates[rid]?.gameModel;
      if (gm) {
        gm.executionMode = executionMode;
        if (executionMode === "step") {
          const roomState = this.options.connection.roomStates[rid];
          Object.keys(roomState.frameStack).forEach((playerId) => {
            roomState.frameStack[playerId] = [];
            roomState.lastFrame[playerId] = gm.frame - 1;
          });
        }
      }
    }

    const ticker = new Ticker(this.timestep, this.targetFPS);
    if (executionMode !== "step") {
      ticker.add(() => this.run());
    } else {
      this._stepInputUnsubscribe = this.options.connection.inputManager.onInputStateChanged(() => {
        this.scheduleStep();
      });
      this._stepConnectionUnsubscribe = this.options.connection.onStepRequested?.(() => {
        this.scheduleStep();
      }) ?? null;
      this._stepEventUnsubscribe = this.options.connection.playerEventManager.onEventAdded(() => {
        this.scheduleStep();
      });
    }

    ticker.start();
    this.ticker = ticker;
  }

  async preloadRoom(
    roomId: string,
    seed?: string,
    { players, coreOverrides }: { players?: string[]; coreOverrides?: { [key: string]: any } } = {}
  ): Promise<GameModel> {
    if (!this.options.connection.localPlayers.every((player) => player.connected)) {
      await this.options.connection.connect();
    }
    const gameModel = await this.options.connection.preloadRoom(roomId, {
      gameInstance: this,
      players,
      seed: seed ?? "NO_SEED",
      coreOverrides,
      buildWorld: this.options.buildWorld,
      onPlayerJoin: this.options.onPlayerJoin,
      onPlayerLeave: this.options.onPlayerLeave,
    });
    gameModel.executionMode = this.options.executionMode ?? "realtime";
    return gameModel;
  }

  async activatePreloadedRoom(
    roomId: string,
    seed?: string,
    {
      localPlayerIndex,
      deferPlayerEntity,
      playerConfig,
      coreOverrides,
    }: { localPlayerIndex?: number; deferPlayerEntity?: boolean; playerConfig?: Partial<T>; coreOverrides?: { [key: string]: any } } = {}
  ): Promise<GameModel> {
    return this.options.connection.activatePreloadedRoom(roomId, {
      gameInstance: this,
      seed: seed ?? "NO_SEED",
      coreOverrides,
      localPlayerIndex,
      deferPlayerEntity,
      playerConfig,
      onPlayerJoin: this.options.onPlayerJoin,
      onPlayerLeave: this.options.onPlayerLeave,
    });
  }

  protected async join(roomId: string, seed?: string, playerConfig?: T, coreOverrides?: { [key: string]: any }) {
    if (!this.options.connection.localPlayers.every((player) => player.connected)) {
      throw new Error("Player not connected");
    }
    for (const player of this.options.connection.localPlayers) {
      if (player.currentRoomId) {
        this.options.connection.leaveRoom(
          player.currentRoomId,
          this.options.connection.roomStates[roomId].gameModel.frame
        );
      }
    }

    await this.options.connection.join(roomId, {
      gameInstance: this,
      seed: seed ?? "NO_SEED",
      coreOverrides,
      onPlayerJoin: this.options.onPlayerJoin,
      onPlayerLeave: this.options.onPlayerLeave,
      playerConfig,
    });
  }

  run() {
    const drawableRooms = new Set(this.options.connection.localPlayers.map((p) => p.currentRoomId));
    const activeRooms = new Set([
      ...this.options.connection.players.map((p) => p.currentRoomId),
      ...this.options.connection.preloadedRoomIds,
    ]);
    if (activeRooms.size > 0) {
      for (const roomId of activeRooms) {
        const gameModel = roomId ? this.options.connection.roomStates[roomId]?.gameModel : null;
        if (gameModel && !gameModel.destroyed) {
          this.runGameLoop(gameModel, drawableRooms.has(roomId));
        }
      }
    }

    // if (this.options.connection.localPlayers[0].currentRoomId) {
    //   this.runGameLoop();
    //   if (this.gameModel.destroyed) {
    //     this.options.connection.leaveRoom();
    //   }
    // }
  }

  /**
   * Force one frame of simulation to execute immediately.
   * In "step" executionMode this is how the simulation advances.
   * Returns true if the step executed, false if blocked by connection state.
   */
  stepManual(): boolean {
    const drawableRooms = new Set(this.options.connection.localPlayers.map((p) => p.currentRoomId));
    const activeRooms = new Set([
      ...this.options.connection.players.map((p) => p.currentRoomId),
      ...this.options.connection.preloadedRoomIds,
    ]);
    if (activeRooms.size === 0) {
      return false;
    }
    let executed = false;
    for (const roomId of activeRooms) {
      const gameModel = roomId ? this.options.connection.roomStates[roomId]?.gameModel : null;
      if (gameModel && !gameModel.destroyed) {
        const result = this.runGameLoop(gameModel, drawableRooms.has(roomId));
        if (result) {
          executed = true;
        }
      }
    }
    return executed;
  }

  private scheduleStep(): void {
    if (this._stepScheduled) {
      return;
    }
    this._stepScheduled = true;
    queueMicrotask(() => {
      this._stepScheduled = false;
      this.stepManual();
    });
  }

  runGameLoop(gameModel: GameModel, draw = true): boolean {
    if (!gameModel) {
      return false;
    }
    try {
      if (this.options.connection.startFrame(gameModel) === false) {
        return false;
      }

      gameModel.step(this.dt);

      if (gameModel.destroyed) {
        console.log("destroyed");
        return false;
      }

      if (draw && !gameModel.preloadOnly && (!flags.FPS_30 || gameModel.frame % 2 === 0)) {
        gameModel.stepDraw();
      }

      this.options.connection.endFrame(gameModel);
      return true;
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}
