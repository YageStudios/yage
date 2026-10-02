import type { GameInstanceOptions } from "./GameInstance";
import { GameInstance } from "./GameInstance";
import type { ReplayStack } from "yage/connection/ConnectionInstance";
import { HistoryConnectionInstance } from "yage/connection/HistoryConnectionInstance";
import Ticker from "./Ticker";
import type { GameModel } from "./GameModel";

// TODO HANDLE MULTILE GAME MODELS

export class GameReplayInstance<T> extends GameInstance<T> {
  protected connection: HistoryConnectionInstance<T>;

  protected playSpeed = 0;
  protected previousFrame = 0;
  protected nextFrame = 0;
  protected currentPlaySpeed = 1;

  protected scrubRequest: number | null = null;

  // Room boot completes asynchronously; callers must await this before
  // driving playback or scrubbing.
  public ready: Promise<void>;

  constructor(
    public replayStack: { [key: string]: ReplayStack<T> },
    options: Omit<GameInstanceOptions<T>, "connection" | "seed" | "achievementService">
  ) {
    const firstRoomId = Object.keys(replayStack)[0];
    if (!firstRoomId || !replayStack[firstRoomId]?.frames) {
      throw new Error(
        "GameReplayInstance: the replay stack is empty or malformed. Record a game first — history persists to IndexedDB while a game runs."
      );
    }
    super({
      ...options,
      seed: replayStack[firstRoomId].seed,
      connection: new HistoryConnectionInstance(replayStack),
    });
    this.connection = this.options.connection as HistoryConnectionInstance<T>;
    const roomId = firstRoomId;
    this.ready = this.initializeRoom(roomId, replayStack[roomId].seed);
  }

  async initializeRoom(
    roomId: string,
    seed?: string,
    { players, coreOverrides }: { players?: string[]; coreOverrides?: { [key: string]: any } } = {}
  ) {
    await this.options.connection.initialize(roomId, {
      gameInstance: this,
      players: players ?? this.options.connection.players.map((p) => p.netId),
      seed: this.replayStack[roomId].seed,
      coreOverrides,
      buildWorld: this.options.buildWorld,
      onPlayerJoin: this.options.onPlayerJoin,
      onPlayerLeave: this.options.onPlayerLeave,
    });

    if (this.ticker) {
      this.ticker.stop();
    }
    const ticker = new Ticker(this.timestep, this.targetFPS);
    ticker.add(() => this.run());
    this.ticker = ticker;

    ticker.start();
  }

  run() {
    const activeRooms = new Set(this.options.connection.players.map((p) => p.currentRoomId));
    if (activeRooms.size > 0) {
      for (const roomId of activeRooms) {
        if (roomId) {
          this.runGameLoop(this.options.connection.roomStates[roomId].gameModel);
        }
      }
    }
    // run() {
    //   if (this.options.connection.localPlayers[0].currentRoomId) {
    //     this.runGameLoop();
    //     if (this.gameModels[this.options.connection.localPlayers[0].currentRoomId].destroyed) {
    //       this.options.connection.leaveRoom();
    //     }
    //   }
  }

  checkScrubs() {
    if (this.scrubRequest !== null) {
      console.log(this.scrubRequest, this.previousFrame, this.nextFrame);
      if (this.scrubRequest <= this.previousFrame) {
        const activeRooms = new Set(this.options.connection.players.map((p) => p.currentRoomId));

        for (const roomId of activeRooms) {
          if (roomId) {
            this.previousFrame = this.connection.loadClosestFrame(
              this.options.connection.roomStates[roomId].gameModel,
              this.scrubRequest
            );
          }
        }
      }
      this.nextFrame = this.scrubRequest;
      this.scrubRequest = null;
    }
  }

  runGameLoop(gameModel: GameModel, draw = true): boolean {
    // const nextFrame = this.previousFrame + this.playSpeed;

    const framesToRun = Math.floor(this.nextFrame) - Math.floor(this.previousFrame);
    this.previousFrame = this.nextFrame;
    this.nextFrame += this.playSpeed;

    if (this.nextFrame >= this.replayStack[gameModel.roomId].frames[this.options.connection.players[0].netId].length) {
      this.nextFrame = this.replayStack[gameModel.roomId].frames[this.options.connection.players[0].netId].length - 1;
    }

    if (framesToRun <= 0) {
      this.checkScrubs();
      return false;
    }

    try {
      for (let i = 0; i < framesToRun; i++) {
        if (this.options.connection.startFrame(gameModel) === false) {
          return false;
        }

        gameModel.step(this.dt);

        if (gameModel.destroyed) {
          console.log("destroyed");
          return false;
        }

        if (i === 0 && draw) {
          gameModel.stepDraw();
        }

        this.options.connection.endFrame(gameModel);
      }
    } catch (e) {
      console.error(e);
      throw e;
    }

    this.checkScrubs();
    return true;
  }

  // Scrub-UI surface: play state, playhead position, tape length.
  get playing(): boolean {
    return this.playSpeed > 0;
  }

  get currentFrame(): number {
    return Math.floor(this.nextFrame);
  }

  get totalFrames(): number {
    const stack = this.replayStack[Object.keys(this.replayStack)[0]];
    const netId = Object.keys(stack.frames)[0] ?? this.options.connection.players[0]?.netId;
    const frames = stack.frames[netId];
    return frames ? frames.length - 1 : 0;
  }

  pausePlayback() {
    this.playSpeed = 0;
  }

  resumePlayback() {
    // Continue from wherever the tape is; rewinding here would restart the
    // recording from frame 0 mid-view.
    this.playSpeed = this.currentPlaySpeed;
  }

  onScrub(frame: number) {
    this.scrubRequest = frame;
  }

  onPlaybackSpeedChange(speed: number) {
    this.currentPlaySpeed = speed;
    if (this.playSpeed !== 0) this.playSpeed = speed;
  }
}
