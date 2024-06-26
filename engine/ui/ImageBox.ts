import AssetLoader from "yage/loader/AssetLoader";
import type { GameModel } from "yage/game/GameModel";
import type { BoxConfig } from "./Box";
import { Box } from "./Box";

export type ImageBoxConfig = BoxConfig & {
  imageKey: string;
  flipX?: boolean;
  flipY?: boolean;
  backgroundSize?: "contain" | "cover" | "auto" | "100% 100%";
};

export class ImageBox extends Box<ImageBoxConfig> {
  move(x: number, y: number): void {
    this.bounds.x = x;
    this.bounds.y = y;
    this._hasChanged = true;
  }

  updateImage(imageKey: string): void {
    this.config.imageKey = imageKey;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  updateInternal(gameModel: GameModel): void {}

  calculateAspectRatioFit(srcWidth: number, srcHeight: number, maxWidth: number, maxHeight: number) {
    const ratio = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);

    return { width: srcWidth * ratio, height: srcHeight * ratio };
  }

  _update(): void {
    super._update();
    if (!this.isVisible()) {
      return;
    }
    const imageElement = this.element;
    if (!imageElement) {
      return;
    }
    imageElement.className = "image-box";

    if (this._config.flipX && this._config.flipY) {
      imageElement.style.transform = "scale(-1,-1)";
    } else if (this._config.flipX) {
      imageElement.style.transform = "scale(-1,1)";
    } else if (this._config.flipY) {
      imageElement.style.transform = "scale(1,-1)";
    }
    if (!this._config.imageKey) {
      imageElement.style.backgroundImage = "none";
      return;
    }

    const img = AssetLoader.getInstance().getImage(this._config.imageKey).image;
    imageElement.style.backgroundImage = "url(" + img.src + ")";
    imageElement.style.backgroundSize = this._config.backgroundSize ?? "contain";
    imageElement.style.backgroundRepeat = "no-repeat";
  }
}
