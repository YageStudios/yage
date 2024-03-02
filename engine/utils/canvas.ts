/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Viewport } from "pixi-viewport";
import {} from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import type { Vector2d } from "./vector";

// export const toCameraSpace = (position: Vector2d, gameModel: GameModel): Vector2d => {
//   const viewport = viewport;
//   const cameraPosition = viewport.toWorld(viewport.center);
//   const relativeX = Math.floor(position.x - cameraPosition.x);
//   const relativeY = Math.floor(position.y - cameraPosition.y);
//   console.log("cameraPosition", relativeX, relativeY);
//   return { x: relativeX, y: relativeY };

//   // const cameraManager = CameraManager.getInstance();
//   // const relativeX = Math.floor(position.x - cameraManager.cameraPosition.x);
//   // const relativeY = Math.floor(position.y - cameraManager.cameraPosition.y);
//   // return { x: relativeX, y: relativeY };
// };

export const fromMouseSpace = (position: Vector2d, pixiViewport: Viewport): Vector2d => {
  const gameCanvas = document.getElementById("uicanvas") as HTMLCanvasElement;
  const canvasPosition = gameCanvas.getBoundingClientRect();
  const xFromCanvas = position.x - canvasPosition.left;
  const yFromCanvas = position.y - canvasPosition.top;

  const percentageX = Math.max(Math.min(1, xFromCanvas / canvasPosition.width), 0) - 0.5;
  const percentageY = Math.max(Math.min(1, yFromCanvas / canvasPosition.height), 0) - 0.5;
  const x = Math.floor((percentageX * pixiViewport.screenWidth) / pixiViewport.scale.x + pixiViewport.center.x);
  const y = Math.floor((percentageY * pixiViewport.screenHeight) / pixiViewport.scale.y + pixiViewport.center.y);

  return { x: x, y: y };
};

export const shouldCull = (
  _gameModel: GameModel,
  ctx: CanvasRenderingContext2D,
  pos: Vector2d,
  radius: number
): boolean => {
  if (
    pos.x + radius < 0 ||
    pos.x - radius > ctx.canvas.width ||
    pos.y + radius < 0 ||
    pos.y - radius > ctx.canvas.height
  ) {
    return true;
  }
  return false;
};

export const mapOrCull = (
  _entity: number,
  _gameModel: GameModel,
  _ctx: CanvasRenderingContext2D,
  _radius?: number
): false | Vector2d => {
  return { x: 0, y: 0 };
  // const pos = toCameraSpace(gameModel.getTypedUnsafe(entity, TransformSchema).position);
  // radius = radius ?? (gameModel.hasComponent(entity, "Radius") ? gameModel.getTypedUnsafe(entity, RadiusSchema).radius : 1);
  // if (shouldCull(gameModel, ctx, pos, radius! * 2)) {
  //   return false;
  // }
  // return pos;
};
