import { assignGlobalSingleton } from "@/global";
import { sound as PixiSound, Sound } from "@pixi/sound";

PixiSound.disableAutoPause = true;

export class PixiSoundLoader {
  pixiSoundLibrary = new Map<string, Sound>();

  static getInstance(): PixiSoundLoader {
    return assignGlobalSingleton("PixiSoundLoader", () => new PixiSoundLoader());
  }

  async loadSound(name: string, assetPath: string) {
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
          this.pixiSoundLibrary.set(name, sound);
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
