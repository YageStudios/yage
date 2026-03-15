import { assignGlobalSingleton } from "yage/global";
import type { Sound } from "@pixi/sound";

export type SoundOptions = {
  baseVolume?: number;
};

export class PixiSoundLoader {
  pixiSoundLibrary = new Map<string, [Sound, SoundOptions]>();
  private pixiSoundPromise?: Promise<typeof import("@pixi/sound")["sound"]>;

  static getInstance(): PixiSoundLoader {
    return assignGlobalSingleton("PixiSoundLoader", () => new PixiSoundLoader());
  }

  private async getPixiSound() {
    if (!this.pixiSoundPromise) {
      this.pixiSoundPromise = import("@pixi/sound").then(({ sound }) => {
        sound.disableAutoPause = true;
        return sound;
      });
    }

    return this.pixiSoundPromise;
  }

  async loadSound(name: string, assetPath: string, soundOptions: SoundOptions = {}): Promise<void> {
    if (!soundOptions.baseVolume) {
      soundOptions.baseVolume = 1;
    }
    const pixiSound = await this.getPixiSound();
    await new Promise<void>((resolve, reject) => {
      pixiSound.add(name, {
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
