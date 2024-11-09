import { stepWorldDraw } from "minecs";
import type { GameInstanceOptions } from "./GameInstance";
import { GameInstance } from "./GameInstance";
import type { ReplayStack } from "yage/connection/ConnectionInstance";
import { HistoryConnectionInstance } from "yage/connection/HistoryConnectionInstance";
import Ticker from "./Ticker";
import { GameModel } from "./GameModel";

// TODO HANDLE MULTILE GAME MODELS

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
    await this.options.connection.initialize(roomId, {
      gameInstance: this,
      players: players ?? this.options.connection.players.map((p) => p.netId),
      seed: this.replayStack.seed,
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

  runGameLoop(gameModel: GameModel) {
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
        if (this.options.connection.startFrame(gameModel) === false) {
          return;
        }

        gameModel.step(this.dt);

        if (gameModel.destroyed) {
          console.log("destroyed");
          return;
        }

        if (i === 0) {
          stepWorldDraw(gameModel);
        }

        this.options.connection.endFrame(gameModel);
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
    const activeRooms = new Set(this.options.connection.players.map((p) => p.currentRoomId));

    for (const roomId of activeRooms) {
      if (roomId) {
        this.connection.loadClosestFrame(this.options.connection.roomStates[roomId].gameModel, 0);
      }
    }
  }

  onScrub(frame: number) {
    this.scrubRequest = frame;
  }

  onPlaybackSpeedChange(speed: number) {
    this.currentPlaySpeed = speed;
    if (this.playSpeed !== 0) this.playSpeed = speed;
  }
}
