import AssetLoader from "@/loader/AssetLoader";
import { animate } from "@/utils/render";
import type { Rectangle } from "./Rectangle";
import type { BoxConfig } from "./Box";
import { Box } from "./Box";
import type { Sprite } from "@/loader/SpriteLoader";

export type AnimatedImageBoxConfig = BoxConfig & {
  spriteKey: string;
  frame: number;
  animationKey: string;
  animationSpeed: number;
  padding?: number;
  xoffset?: number;
  yoffset?: number;
};

export class AnimatedImageBox<T extends AnimatedImageBoxConfig = AnimatedImageBoxConfig> extends Box<T> {
  animationInterval: any;
  constructor(rect: Rectangle, _config: Partial<T>) {
    super(rect, _config);

    if (this._config.animationSpeed !== 0) {
      this.animationInterval = setInterval(() => {
        this._config.frame++;
      }, this._config.animationSpeed * 1000);
    }
  }

  updateImage(spriteKey: string): void {
    this._config.spriteKey = spriteKey;
  }

  updateAnimation(animationKey: string): void {
    this._config.animationKey = animationKey;
  }

  setAnimationFrame(frame: number): void {
    this._config.frame = frame;
  }

  calculateAspectRatioFit(
    srcWidth: number,
    srcHeight: number,
    maxWidth: number,
    maxHeight: number,
    xoffset: number = 0,
    yoffset: number = 0
  ) {
    var ratio = Math.min(maxWidth / srcWidth, maxHeight / srcHeight);

    return {
      width: srcWidth * ratio,
      height: srcHeight * ratio,
      xoffset: xoffset,
      yoffset: yoffset,
    };
  }

  drawInternal(ctx: CanvasRenderingContext2D, ui: HTMLDivElement): void {
    if (!this._config.spriteKey) {
      return;
    }

    const img = AssetLoader.getInstance().getImage(this._config.spriteKey);

    const padding = this._config.padding !== undefined ? this._config.padding : 5;
    const widthWithPadding = this.bounds.width - padding * 2;
    const heightWithPadding = this.bounds.height - padding * 2;

    const resizedImageBounds = this.calculateAspectRatioFit(
      img.width,
      img.height,
      widthWithPadding,
      heightWithPadding,
      img.xoffset,
      img.yoffset
    );
    animate(ctx, this._config.animationKey, this._config.frame, {
      x: (this.bounds.x as number) + padding + resizedImageBounds.width / 2 - (this._config.xoffset ?? 0),
      y: (this.bounds.y as number) + padding + resizedImageBounds.height / 2 - (this._config.yoffset ?? 0),
      width: resizedImageBounds.width,
      height: resizedImageBounds.height,
      xoffset: resizedImageBounds.xoffset,
      yoffset: resizedImageBounds.yoffset,
    });
  }
}
