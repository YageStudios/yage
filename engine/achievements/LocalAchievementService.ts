import { Persist } from "@/persist/persist";
import { Achievement, AchievementService } from "./AchievementService";
import Toastify from "toastify-js";
import "toastify-js/src/toastify.css";

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

  isFlushing: boolean = false;
  flushQueue: Array<() => Promise<void>> = [];

  async flush(): Promise<void> {
    if (this.isFlushing) {
      return new Promise<void>((resolve) => this.flushQueue.push(resolve as () => Promise<void>));
    }

    this.isFlushing = true;

    const promises = [];
    for (const playerId in this.queuedUpdates) {
      for (let i = 0; i < this.queuedUpdates[playerId].length; i++) {
        const name = this.queuedUpdates[playerId][i];
        promises.push(
          Persist.getInstance().set(`achievement-${playerId}-${name}`, this.playerStates[playerId][name] ?? 0)
        );
      }
    }

    // Clear the queuedUpdates
    this.queuedUpdates = {};
    await Promise.all(promises);

    // Check if there are any pending flush calls
    while (this.flushQueue.length > 0) {
      const nextFlush = this.flushQueue.shift();
      if (nextFlush) {
        await nextFlush();
      }
    }
    this.autoFlushCounter = 0;

    this.isFlushing = false;
  }

  autoFlush: number = 100;
  autoFlushCounter: number = 0;

  queuedUpdates: {
    [key: string]: string[];
  } = {};

  private queueUpdate(playerId: string, achievement: string) {
    this.queuedUpdates[playerId] = this.queuedUpdates[playerId] || [];
    if (!this.queuedUpdates[playerId].includes(achievement)) {
      this.queuedUpdates[playerId].push(achievement);
    }
    if (this.autoFlushCounter++ >= this.autoFlush) {
      this.flush();
    }
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

  async unlockAchievement(playerId: string, name: string): Promise<void> {
    const achievement = this.achievements.find((a) => a.name === name);
    if (!achievement) {
      return Promise.reject("Achievement not found");
    }
    this.setAchievementProgress(playerId, name, achievement.target);
    await this.flush();
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

  setAchievementProgress(playerId: string, name: string, progress: number): boolean {
    const achievement = this.achievements.find((a) => a.name === name);
    if (!achievement) {
      throw new Error("Achievement not found");
    }
    const isCompleteAlready = this.playerStates[playerId][name] >= achievement.target;
    progress = Math.min(progress, achievement.target);
    this.playerStates[playerId][name] = progress;
    this.queueUpdate(playerId, name);
    if (isCompleteAlready) {
      console.log("Already complete", name, progress, achievement.target);
      return true;
    }

    if (progress >= achievement.target) {
      Toastify({
        text: `Achievement unlocked: ${achievement.name}`,
        duration: 3000,
        gravity: "top",
        position: "right",
        backgroundColor: "green",
      }).showToast();
      this.flush();
      return true;
    }
    return false;
  }

  incrementAchievementProgress(playerId: string, name: string, increment: number): boolean {
    const achievement = this.achievements.find((a) => a.name === name);
    if (!achievement) {
      throw new Error("Achievement not found");
    }
    const progress = (this.playerStates[playerId][name] ?? 0) + increment;
    return this.setAchievementProgress(playerId, name, progress);
  }

  async resetAchievementProgress(playerId: string, name: string): Promise<void> {
    this.playerStates[playerId][name] = 0;
    await this.setAchievementProgress(playerId, name, 0);
  }
}
