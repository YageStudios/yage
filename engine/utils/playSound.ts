import { getAudio } from "yage/audio/runtime";
import AssetLoader from "yage/loader/AssetLoader";
import type { Vector2d } from "./vector";

export type PlaySoundOptions = {
  volume?: number;
  position?: Vector2d;
  filters?: any[];
};

export const playSound = (name: string, { volume = 1, position, filters }: PlaySoundOptions = {}) => {
  const audio = getAudio();
  if (audio?.list().some(sound => sound.id === name)) {
    return audio.play(name, { volume, ...(position ? { position: [position.x, 0, position.y] as const } : {}) });
  }
  const [sound, soundOptions] = AssetLoader.getInstance().getSound(name);
  return sound.play({ volume: (soundOptions.baseVolume ?? 1) * volume, filters });
};
