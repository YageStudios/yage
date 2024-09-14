import { stepWorldDraw } from "minecs";
import type { GameInstanceOptions } from "./GameInstance";
import { GameInstance } from "./GameInstance";
import type { ReplayStack } from "yage/connection/CoreConnectionInstance";
import { HistoryConnectionInstance } from "yage/connection/HistoryConnectionInstance";
import Ticker from "./Ticker";

export class GameReplayInstance<T> extends GameInstance<T> {
  protected connection: HistoryConnectionInstance<T>;

  protected playSpeed = 0;
  protected previousFrame = 0;
  protected nextFrame = 0;
  protected currentPlaySpeed = 1;

  protected scrubRequest: number | null = null;

  constructor(
    public replayStack: ReplayStack<T>,
    options: Omit<GameInstanceOptions<T>, "connection" | "seed" | "achievementService">
  ) {
    super({
      ...options,
      seed: replayStack.seed,
      connection: new HistoryConnectionInstance(replayStack),
    });
    this.connection = this.options.connection as HistoryConnectionInstance<T>;

    this.initializeRoom("replay", replayStack.seed);
  }

  async initializeRoom(
    roomId: string,
    seed?: string,
    { players, coreOverrides }: { players?: string[]; coreOverrides?: { [key: string]: any } } = {}
  ) {
    const gameModel = await this.options.connection.initialize(roomId, {
      gameInstance: this,
      players: players ?? this.options.connection.players.map((p) => p.netId),
      seed: this.replayStack.seed,
      coreOverrides,
      buildWorld: this.options.buildWorld,
      onPlayerJoin: this.options.onPlayerJoin,
      onPlayerLeave: this.options.onPlayerLeave,
    });

    this.gameModel = gameModel;

    if (this.ticker) {
      this.ticker.stop();
    }
    const ticker = new Ticker(this.timestep, this.targetFPS);
    ticker.add(() => this.run());

    ticker.start();
  }

  run() {
    if (this.options.connection.localPlayers[0].currentRoomId) {
      this.runGameLoop();
      if (this.gameModel.destroyed) {
        this.options.connection.leaveRoom();
      }
    }
  }

  checkScrubs() {
    if (this.scrubRequest !== null) {
      console.log(this.scrubRequest, this.previousFrame, this.nextFrame);
      if (this.scrubRequest <= this.previousFrame) {
        this.previousFrame = this.connection.loadClosestFrame(this.gameModel, this.scrubRequest);
      }
      this.nextFrame = this.scrubRequest;
      this.scrubRequest = null;
    }
  }

  runGameLoop() {
    if (!this.gameModel) {
      return;
    }
    // const nextFrame = this.previousFrame + this.playSpeed;

    const framesToRun = Math.floor(this.nextFrame) - Math.floor(this.previousFrame);
    this.previousFrame = this.nextFrame;
    this.nextFrame += this.playSpeed;

    if (this.nextFrame >= this.replayStack.frames[this.options.connection.players[0].netId].length) {
      this.nextFrame = this.replayStack.frames[this.options.connection.players[0].netId].length - 1;
    }

    if (framesToRun <= 0) {
      this.checkScrubs();
      return;
    }

    try {
      for (let i = 0; i < framesToRun; i++) {
        if (this.options.connection.startFrame(this.gameModel) === false) {
          return;
        }

        this.gameModel.step(this.dt);

        if (this.gameModel.destroyed) {
          console.log("destroyed");
          return;
        }

        if (i === 0) {
          stepWorldDraw(this.gameModel);
        }

        this.options.connection.endFrame(this.gameModel);
      }
    } catch (e) {
      console.error(e);
      throw e;
    }

    this.checkScrubs();
  }

  pausePlayback() {
    this.playSpeed = 0;
  }

  resumePlayback() {
    this.playSpeed = this.currentPlaySpeed;
    this.connection.loadClosestFrame(this.gameModel, 0);
  }

  onScrub(frame: number) {
    this.scrubRequest = frame;
  }

  onPlaybackSpeedChange(speed: number) {
    this.currentPlaySpeed = speed;
    if (this.playSpeed !== 0) this.playSpeed = speed;
  }
}
