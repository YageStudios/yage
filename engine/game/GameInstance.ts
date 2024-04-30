import type { ConnectionInstance } from "yage/connection/ConnectionInstance";
import type { GameModel } from "./GameModel";
import { UIService } from "yage/ui/UIService";
import { flags } from "yage/console/flags";
import type { AchievementService } from "yage/achievements/AchievementService";
import { stepWorldDraw } from "minecs";

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

  private async join(roomId: string, seed?: string, playerConfig?: T, coreOverrides?: { [key: string]: any }) {
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
      if (this.options.connection.startFrame(this.gameModel) === false) {
        return;
      }
      const dt = this.dt;
      this.lastTime = performance.now();

      this.gameModel.step(dt);

      if (this.gameModel.destroyed) {
        console.log("destroyed");
        return;
      }

      if (!flags.FPS_30 || this.gameModel.frame % 2 === 0) {
        stepWorldDraw(this.gameModel);
      }
      this.gameModel.timeElapsed += dt;

      this.options.connection.endFrame(this.gameModel);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}
