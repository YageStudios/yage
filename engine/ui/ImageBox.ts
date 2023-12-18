import AssetLoader from "@/loader/AssetLoader";
import type { GameModel } from "@/game/GameModel";
import type { Rectangle } from "./Rectangle";
import type { BoxConfig } from "./Box";
import { Box } from "./Box";
import { positionToCanvasSpace } from "./utils";

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

  drawInternal(canvas: any, ui: HTMLDivElement): void {
    const imageElement = this._element ?? document.createElement("div");

    if (!this._element) {
      ui.appendChild(imageElement);
      this._element = imageElement;
    }

    const [x, y, width, height] = positionToCanvasSpace(this.bounds, ui);
    imageElement.className = "image-box";
    imageElement.style.position = "absolute";
    imageElement.style.left = `${x}px`;
    imageElement.style.top = `${y}px`;
    imageElement.style.width = `${width}px`;
    imageElement.style.height = `${height}px`;

    if (this._config.flipX && this._config.flipY) {
      imageElement.style.transform = "scale(-1,-1)";
    } else if (this._config.flipX) {
      imageElement.style.transform = "scale(-1,1)";
    } else if (this._config.flipY) {
      imageElement.style.transform = "scale(1,-1)";
    }

    const img = AssetLoader.getInstance().getImage(this._config.imageKey).image;
    imageElement.style.backgroundImage = "url(" + img.src + ")";
    imageElement.style.backgroundSize = this._config.backgroundSize ?? "contain";
  }
}
