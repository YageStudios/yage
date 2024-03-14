import { ConnectionInstance } from "@/connection/ConnectionInstance";
import { GameModel } from "./GameModel";
import { UIService } from "@/ui/UIService";
import { flags } from "@/console/flags";
import { AchievementService } from "@/achievements/AchievementService";

export type GameInstanceOptions<T> = {
  gameName: string;
  connection: ConnectionInstance<T>;
  uiService: boolean | UIService;
  seed?: string;
  buildWorld: (gameModel: GameModel, firstPlayerConfig: any) => void;
  onPlayerJoin: (gameModel: GameModel, playerId: string, playerConfig: any) => number;
  onPlayerLeave: (gameModel: GameModel, playerId: string) => void;
  achievementService?: AchievementService;
};

export class GameInstance<T> {
  public gameModel: GameModel;
  public achievementService: AchievementService;
  private uiService?: UIService;

  private lastTime = 0;
  private dt = 16;
  render30Fps: boolean;

  constructor(public options: GameInstanceOptions<T>) {
    if (options.uiService) {
      this.uiService = options.uiService === true ? UIService.getInstance() : options.uiService;
    }
    this.achievementService = options.achievementService ?? {
      registerAchievement: () => {},
      update: async () => {},
      getAchievements: () => [],
      unlockAchievement: async () => {},
      getUnlockedAchievements: () => [],
      getAchievement: () => null,
      getAchievementProgress: () => 0,
      setAchievementProgress: async () => {},
      resetAchievementProgress: async () => {},
    };
  }

  async initialize(
    roomId: string,
    seed?: string,
    { players, coreOverrides }: { players?: string[]; coreOverrides?: { [key: string]: any } } = {}
  ) {
    if (
      !this.options.connection.localPlayers.every(({ connected }) => connected) &&
      !this.options.connection.solohost
    ) {
      throw new Error("Player not connected");
    }
    if (this.options.connection.localPlayers[0].currentRoomId) {
      this.options.connection.leaveRoom();
    }

    if (this.gameModel && !this.gameModel.destroyed) {
      this.gameModel.destroy();
    }

    if (this.options.connection.hasRoom(roomId)) {
      this.join(roomId, seed);
    } else {
      const gameModel = await this.options.connection.initialize(roomId, {
        gameInstance: this,
        players: players ?? this.options.connection.players.map((p) => p.netId),
        seed: seed ?? "NO_SEED",
        coreOverrides,
        buildWorld: this.options.buildWorld,
        onPlayerJoin: this.options.onPlayerJoin,
        onPlayerLeave: this.options.onPlayerLeave,
      });

      this.gameModel = gameModel;
    }
  }

  async host(roomId: string, seed?: string, playerConfig?: T, coreOverrides?: { [key: string]: any }) {
    if (
      !this.options.connection.localPlayers.every(({ connected }) => connected) &&
      !this.options.connection.solohost
    ) {
      throw new Error("Player not connected");
    }
    if (this.options.connection.localPlayers[0].currentRoomId) {
      this.options.connection.leaveRoom();
    }

    if (this.gameModel && !this.gameModel.destroyed) {
      this.gameModel.destroy();
    }

    const gameModel = await this.options.connection.host(roomId, {
      gameInstance: this,
      seed: seed ?? "NO_SEED",
      coreOverrides,
      buildWorld: this.options.buildWorld,
      onPlayerJoin: this.options.onPlayerJoin,
      onPlayerLeave: this.options.onPlayerLeave,
      playerConfig,
    });

    this.gameModel = gameModel;
  }

  async join(roomId: string, seed?: string, playerConfig?: T, coreOverrides?: { [key: string]: any }) {
    if (!this.options.connection.player.connected) {
      throw new Error("Player not connected");
    }
    if (this.options.connection.player.currentRoomId) {
      this.options.connection.leaveRoom();
    }

    if (this.gameModel && !this.gameModel.destroyed) {
      this.gameModel.destroy();
    }

    const gameModel = await this.options.connection.join(roomId, {
      gameInstance: this,
      seed: seed ?? "NO_SEED",
      coreOverrides,
      onPlayerLeave: this.options.onPlayerLeave,
      playerConfig,
    });
    this.gameModel = gameModel;
  }

  run() {
    if (this.options.connection.localPlayers[0].currentRoomId) {
      this.runGameLoop();
      if (this.gameModel.destroyed) {
        this.options.connection.leaveRoom();
      }
    }
  }

  runGameLoop() {
    if (!this.gameModel) {
      return;
    }
    try {
      if (this.options.connection.frameSkipCheck(this.gameModel)) {
        return;
      }

      this.options.connection.handleInput(this.gameModel);
      const dt = this.dt;
      this.gameModel.frameDt = dt;
      this.lastTime = performance.now();

      this.gameModel.run();

      if (this.gameModel.destroyed) {
        console.log("destroyed");
        return;
      }

      // if (this.gameModel.getComponent(this.gameModel.coreEntity, FrameRateSchema)?.averageFrameRate ?? 60 < 50) {
      //   this.render30Fps = true;
      // } else if (this.gameModel.getComponent(this.gameModel.coreEntity, FrameRateSchema)?.averageFrameRate ?? 50 > 58) {
      //   this.render30Fps = false;
      // }

      if (!flags.FPS_30 || this.gameModel.frame % 2 === 0) {
        this.gameModel.runPredraw();

        this.gameModel.runPixiComponents();
        this.gameModel.runUIComponents();
      }
      this.gameModel.frame++;
      this.gameModel.timeElapsed += dt;
      this.gameModel.cleanup();

      this.options.connection.run(this.gameModel);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}
