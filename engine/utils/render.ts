import AssetLoader from "@/loader/AssetLoader";
import type { Sprite } from "@/loader/SpriteLoader";

export const animate = (
  ctx: CanvasRenderingContext2D,
  animationName: string,
  animationIndex: number,
  {
    x,
    y,
    width,
    height,
    scale = 1,
    xoffset = 0,
    yoffset = 0,
  }: {
    x: number;
    y: number;
    width: number;
    height: number;
    scale?: number;
    xoffset?: number;
    yoffset?: number;
  }
) => {
  const animation = AssetLoader.getInstance().getSprite(animationName) as Sprite[];
  const randFrame = Math.floor(animationIndex) % animation.length;
  if (randFrame < 0) {
    console.warn("randFrame < 0", animationName, animationIndex);
    return;
  }
  const aniFrame = animation[randFrame] as Sprite;

  const image = aniFrame.image;
  const { x: ix, y: iy, width: iwidth, height: iheight, yoffset: iyoffset = 0, xoffset: ixoffset = 0 } = aniFrame;

  ctx.drawImage(
    image,
    ix,
    iy,
    iwidth,
    iheight,
    x - Math.round(width * scale) / 2 + xoffset * scale + ixoffset,
    y - Math.round(width * scale) / 2 + yoffset * scale + iyoffset,
    width * scale,
    height * scale
  );
};
