import { assignGlobalSingleton } from "yage/global";
import type { Sound } from "@pixi/sound";
import { sound as PixiSound } from "@pixi/sound";

PixiSound.disableAutoPause = true;

export type SoundOptions = {
  baseVolume?: number;
};

export class PixiSoundLoader {
  pixiSoundLibrary = new Map<string, [Sound, SoundOptions]>();

  static getInstance(): PixiSoundLoader {
    return assignGlobalSingleton("PixiSoundLoader", () => new PixiSoundLoader());
  }

  async loadSound(name: string, assetPath: string, soundOptions: SoundOptions = {}): Promise<void> {
    if (!soundOptions.baseVolume) {
      soundOptions.baseVolume = 1;
    }
    await new Promise<void>((resolve, reject) => {
      PixiSound.add(name, {
        url: assetPath,
        preload: true,
        loaded: (err, sound) => {
          if (err) {
            reject(err.message);
          }
          if (sound === undefined) {
            reject("Sound is undefined");
            return;
          }
          this.pixiSoundLibrary.set(name, [sound, soundOptions]);
          resolve();
        },
      });
    });
  }

  get(name: string) {
    const resource = this.pixiSoundLibrary.get(name);
    if (!resource) {
      throw new Error(`Sound resource ${name} not found`);
    }
    return resource;
  }
}
