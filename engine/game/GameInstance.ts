import type { ConnectionInstance } from "yage/connection/ConnectionInstance";
import type { GameModel } from "./GameModel";
import type { UIService } from "yage/ui/UIService";
import { flags } from "yage/console/flags";
import type { AchievementService } from "yage/achievements/AchievementService";
import { stepWorldDraw } from "minecs";
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
};

export class GameInstance<T> {
  // public gameModel: GameModel;
  public achievementService: AchievementService;
  protected dt = 16;

  protected ticker: Ticker;
  protected timestep: Readonly<SceneTimestep> = "fixed";
  protected targetFPS: number = 60;

  public gameModels: {
    [roomId: string]: GameModel;
  } = {};

  render30Fps: boolean;

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
    if (
      !this.options.connection.localPlayers.every(({ connected }) => connected) &&
      !this.options.connection.solohost
    ) {
      throw new Error("Player not connected");
    }
    if (this.options.connection.localPlayers[0].currentRoomId) {
      // TODO: this needs to handle multiple local players
      this.options.connection.leaveRoom(this.options.connection.localPlayers[0].currentRoomId);
    }

    if (this.gameModels[roomId] && !this.gameModels[roomId].destroyed) {
      this.gameModels[roomId].destroy();
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

      this.gameModels[roomId] = gameModel;
    }

    if (this.ticker) {
      this.ticker.stop();
    }
    const ticker = new Ticker(this.timestep, this.targetFPS);
    ticker.add(() => this.run());

    ticker.start();
  }

  protected async join(roomId: string, seed?: string, playerConfig?: T, coreOverrides?: { [key: string]: any }) {
    if (!this.options.connection.player.connected) {
      throw new Error("Player not connected");
    }
    // TODO: this needs to handle multiple local players
    if (this.options.connection.player.currentRoomId) {
      this.options.connection.leaveRoom(this.options.connection.player.currentRoomId);
    }

    if (this.gameModels[roomId] && !this.gameModels[roomId].destroyed) {
      this.gameModels[roomId].destroy();
    }

    const gameModel = await this.options.connection.join(roomId, {
      gameInstance: this,
      seed: seed ?? "NO_SEED",
      coreOverrides,
      onPlayerLeave: this.options.onPlayerLeave,
      playerConfig,
    });
    this.gameModels[roomId] = gameModel;
  }

  run() {
    const activeRooms = new Set(this.options.connection.players.map((p) => p.currentRoomId));
    if (activeRooms.size > 0) {
      for (const roomId of activeRooms) {
        if (roomId) {
          if (this.gameModels[roomId]) {
            this.runGameLoop(roomId);
            if (this.gameModels[roomId].destroyed) {
              this.options.connection.leaveRoom(roomId);
            }
          }
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

  runGameLoop(roomId: string) {
    if (!this.gameModels[roomId]) {
      return;
    }
    try {
      if (this.options.connection.startFrame(this.gameModels[roomId]) === false) {
        return;
      }

      this.gameModels[roomId].step(this.dt);

      if (this.gameModels[roomId].destroyed) {
        console.log("destroyed");
        return;
      }

      if (!flags.FPS_30 || this.gameModels[roomId].frame % 2 === 0) {
        stepWorldDraw(this.gameModels[roomId]);
      }

      this.options.connection.endFrame(this.gameModels[roomId]);
    } catch (e) {
      console.error(e);
      throw e;
    }
  }
}
