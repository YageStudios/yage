import { Persist } from "@/persist/persist";
import { Achievement, AchievementService } from "./AchievementService";

export class LocalAchievementService implements AchievementService {
  private achievements: Achievement[] = [];
  public playerStates: {
    [key: string]: {
      [key: string]: number;
    };
  } = {};

  constructor() {
    // @ts-ignore
    window.achievementService = this;
  }

  registerAchievement(achievement: Omit<Achievement, "progress">) {
    Persist.getInstance().set(`achievementdata-${achievement.name}`, {
      name: achievement.name,
      description: achievement.description,
      target: achievement.target,
    });
    if (!this.achievements.find((a) => a.name === achievement.name)) {
      this.achievements.push({ ...achievement, progress: 0, target: achievement.target });
      for (const playerId in this.playerStates) {
        this.playerStates[playerId][achievement.name] = this.playerStates[playerId][achievement.name] || 0;
      }
    } else {
      const index = this.achievements.findIndex((a) => a.name === achievement.name);
      if (achievement.description && !this.achievements[index].description) {
        this.achievements[index].description = achievement.description;
      }
    }
  }

  async update(playerId: string): Promise<void> {
    const playerState = this.playerStates[playerId] || {
      ...this.achievements.reduce((acc, a) => {
        acc[a.name] = 0;
        return acc;
      }, {} as { [key: string]: number }),
    };
    this.playerStates[playerId] = playerState;
    const keys = Object.keys(playerState);
    const dbKeys = await Persist.getInstance().listKeys();

    const achievementsToFetch = dbKeys.filter((key) => key.startsWith("achievementdata-"));
    await Promise.all(
      achievementsToFetch.map(async (key) => {
        const achievement = await Persist.getInstance().get(key);
        if (!this.achievements.find((a) => a.name === achievement.name)) {
          this.registerAchievement(achievement);
        }
      })
    );

    dbKeys.forEach((key) => {
      const [_prefix, _playerId, achievementName] = key.split("-");
      if (_prefix === "achievement" && _playerId === playerId && !keys.includes(achievementName)) {
        keys.push(achievementName);
      }
      if (_prefix === "achievementdata") {
      }
    });

    await Promise.all(
      keys.map(async (key) => {
        try {
          const progress = await Persist.getInstance().get(`achievement-${playerId}-${key}`);
          this.playerStates[playerId][key] = progress;
        } catch (e) {
          this.playerStates[playerId][key] = 0;
        }
      })
    );
  }

  getAchievements() {
    return this.achievements;
  }

  unlockAchievement(playerId: string, name: string): Promise<void> {
    const achievement = this.achievements.find((a) => a.name === name);
    if (!achievement) {
      return Promise.reject("Achievement not found");
    }
    return this.setAchievementProgress(playerId, name, achievement.target);
  }

  getUnlockedAchievements(playerId: string): string[] {
    return Object.keys(this.playerStates[playerId]).filter(
      (key) => this.playerStates[playerId][key] === this.achievements.find((a) => a.name === key)?.target
    );
  }

  getAchievement(playerId: string, name: string): Achievement | null {
    const achievement = this.achievements.find((a) => a.name === name);

    if (!achievement) {
      return null;
    }
    const key = `achievement-${playerId}-${name}`;
    return {
      name: achievement.name,
      description: achievement.description,
      progress: this.playerStates[playerId][name] || 0,
      target: achievement.target,
    };
  }

  getAchievementProgress(playerId: string, name: string): number {
    return this.playerStates[playerId][name] || 0;
  }

  async setAchievementProgress(playerId: string, name: string, progress: number): Promise<void> {
    const achievement = this.achievements.find((a) => a.name === name);
    if (!achievement) {
      return Promise.reject("Achievement not found");
    }
    progress = Math.min(progress, achievement.target);
    this.playerStates[playerId][name] = progress;
    await Persist.getInstance().set(`achievement-${playerId}-${name}`, progress);
  }

  async resetAchievementProgress(playerId: string, name: string): Promise<void> {
    this.playerStates[playerId][name] = 0;
    await this.setAchievementProgress(playerId, name, 0);
  }
}
