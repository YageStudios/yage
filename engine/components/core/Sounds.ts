import { Component, Schema } from "@/decorators/type";
import { System } from "../System";
import { GameModel } from "@/game/GameModel";
import { DEPTHS, registerSystem } from "../ComponentRegistry";
import AssetLoader from "@/loader/AssetLoader";

@Component("Sounds")
class SoundsSchema extends Schema {}

class SoundsSystem implements System {
  schema = SoundsSchema;
  type = "Sounds";
  depth = DEPTHS.PREDRAW;
  runAll(gameModel: GameModel) {
    const sounds = gameModel.soundQueue;
    const assetLoader = AssetLoader.getInstance();
    for (let i = 0; i < sounds.length; i++) {
      const sound = sounds[i];
      const soundAsset = assetLoader.getSound(sound.sound);
      if (soundAsset) {
        soundAsset.play();
      }
    }
  }
  cleanup?: ((entity: number, gameModel: GameModel, ejecting: boolean) => void) | undefined;
}

registerSystem(SoundsSystem);
