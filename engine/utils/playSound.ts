import AssetLoader from "@/loader/AssetLoader";
import { Vector2d } from "./vector";

export type PlaySoundOptions = {
  volume?: number;
  position?: Vector2d;
  filters?: any[];
};

export const playSound = (name: string, { volume = 1 }: PlaySoundOptions = {}) => {
  const [sound, soundOptions] = AssetLoader.getInstance().getSound(name);
  sound.volume = (soundOptions.baseVolume ?? 1) * volume;
  sound.play();
};
