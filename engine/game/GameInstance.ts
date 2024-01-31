import { ConnectionInstance } from "@/connection/ConnectionInstance";
import { GameModel } from "./GameModel";
import { UIService } from "@/ui/UIService";
import { Scene } from "./Scene";
import { GameCoordinator } from "./GameCoordinator";
import { FrameRateSchema } from "@/schemas/core/FrameRate";

export type GameInstanceOptions<T> = {
  gameName: string;
  connection: ConnectionInstance<T>;
  uiService: boolean | UIService;
  seed?: string;
  buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void;
  onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: any) => number;
  onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
};

export class GameInstance<T> {
  public gameModel: GameModel;
  private uiService?: UIService;

  private lastTime = 0;
  private dt = 16;
  render30Fps: boolean;

  constructor(public options: GameInstanceOptions<T>) {
    if (options.uiService) {
      this.uiService = options.uiService === true ? UIService.getInstance() : options.uiService;
    }
  }

  host(roomId: string, seed?: string, playerConfig?: T) {
    if (!this.options.connection.player.connected && !this.options.connection.solohost) {
      throw new Error("Player not connected");
    }
    if (this.options.connection.player.currentRoomId) {
      this.options.connection.leave();
    }

    if (this.gameModel && !this.gameModel.destroyed) {
      this.gameModel.destroy();
    }

    this.gameModel = new GameModel(GameCoordinator.GetInstance(), this, seed);
    this.options.buildWorld(this.gameModel, { ...this.options.connection.player.config, ...playerConfig });

    return this.options.connection.host(roomId, {
      gameModel: this.gameModel,
      onPlayerJoin: this.options.onPlayerJoin,
      onPlayerLeave: this.options.onPlayerLeave,
      playerConfig,
    });
  }

  join(roomId: string, seed?: string, playerConfig?: T) {
    if (!this.options.connection.player.connected) {
      throw new Error("Player not connected");
    }
    if (this.options.connection.player.currentRoomId) {
      this.options.connection.leave();
    }

    if (this.gameModel && !this.gameModel.destroyed) {
      this.gameModel.destroy();
    }

    this.gameModel = new GameModel(GameCoordinator.GetInstance(), this, seed);

    return this.options.connection.join(roomId, {
      gameModel: this.gameModel,
      onPlayerLeave: this.options.onPlayerLeave,
      playerConfig,
    });
  }

  run() {
    if (this.options.connection.player.currentRoomId) {
      this.runGameLoop();
      if (this.gameModel.destroyed) {
        this.options.connection.leave();
      }
    }
  }

  runGameLoop() {
    try {
      if (this.options.connection.frameSkipCheck(this.gameModel)) {
        return;
      }

      this.options.connection.handleInput(this.gameModel);
      const dt = this.dt;
      this.gameModel.frameDt = dt;
      this.lastTime = performance.now();

      this.gameModel.run();
      this.gameModel.cleanup();

      if (this.gameModel.destroyed) {
        console.log("destroyed");
        return;
      }

      this.gameModel.frame++;
      this.gameModel.timeElapsed += dt;

      // if (this.gameModel.getComponent(this.gameModel.coreEntity, FrameRateSchema)?.averageFrameRate ?? 60 < 50) {
      //   this.render30Fps = true;
      // } else if (this.gameModel.getComponent(this.gameModel.coreEntity, FrameRateSchema)?.averageFrameRate ?? 50 > 58) {
      //   this.render30Fps = false;
      // }

      // if (!this.render30Fps || this.gameModel.frame % 2 === 0) {
      this.gameModel.runPixiComponents();
      this.gameModel.runUIComponents();
      // }

      this.options.connection.run(this.gameModel);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}
