import { assignGlobalSingleton } from "@/global";
import "pixi-spine";
import { Spine } from "pixi-spine";
import * as PIXI from "pixi.js";

export class PixiSpineLoader {
  pixiSpineLibrary = new Map<string, any>();

  static getInstance(): PixiSpineLoader {
    return assignGlobalSingleton("PixiSpineLoader", () => new PixiSpineLoader());
  }

  async loadSpine(name: string, assetPath: string) {
    const resource = await PIXI.Assets.load(assetPath);
    this.pixiSpineLibrary.set(name, resource);
  }

  get(name: string) {
    const resource = this.pixiSpineLibrary.get(name);
    if (!resource) {
      throw new Error(`Spine resource ${name} not found`);
    }
    return new Spine(resource.spineData);
  }
}
