import AssetLoader from "@/loader/AssetLoader";
import { Vector2d } from "./vector";

export type PlaySoundOptions = {
  volume?: number;
  position?: Vector2d;
  filters?: any[];
};

export const playSound = (name: string, { volume = 1 }: PlaySoundOptions = {}) => {
  const sound = AssetLoader.getInstance().getSound(name);
  sound.volume = volume;
  sound.play();
};
