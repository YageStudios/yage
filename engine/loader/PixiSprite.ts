import type { Vector2d } from "../utils/vector";

export interface SpriteAnimationDefinition {
  name: string;
  startPos: Vector2d;
  numFrames: number;
}

export interface SpriteDefinition {
  imageName: string;
  spriteName: string;
  imageSize: Vector2d;
  spriteSize: Vector2d;
  sourcePos: Vector2d;
  animations: SpriteAnimationDefinition[];
  frameRate: number;
  offsets?: Vector2d;
  scale?: string;
}
