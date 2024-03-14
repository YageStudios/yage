export type Achievement = {
  name: string;
  description: string;
  progress: number;
  target: number;
};

export abstract class AchievementService {
  abstract update(playerId: string): Promise<void>;

  abstract registerAchievement(achievement: Omit<Achievement, "progress">): void;

  abstract getAchievements(playerId: string): Achievement[];

  abstract unlockAchievement(playerId: string, name: string): Promise<void>;
  abstract getUnlockedAchievements(playerId: string): string[];

  abstract getAchievement(playerId: string, name: string): Achievement | null;

  abstract getAchievementProgress(playerId: string, name: string): number;
  abstract setAchievementProgress(playerId: string, name: string, progress: number): Promise<void>;

  abstract resetAchievementProgress(playerId: string, name: string): Promise<void>;
}
