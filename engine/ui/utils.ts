import { Vector2d } from "@/utils/vector";
import { Position, Rectangle } from "./Rectangle";

export const toCanvasSpace = (mouseX: number, mouseY: number, element: HTMLElement): Vector2d => {
  const { width, height, top: offsetY, left: offsetX } = element.getBoundingClientRect();

  const xPercentage = (mouseX - offsetX) / width;
  const yPercentage = (mouseY - offsetY) / height;

  return { x: Math.floor(xPercentage * 1920), y: Math.floor(yPercentage * 1080) };
};

const scale = () => {
  let width = window.innerWidth;
  let height = (window.innerWidth * 9) / 16;
  if (height > window.innerHeight) {
    height = window.innerHeight;
    width = (window.innerHeight * 16) / 9;
  }

  return Math.max(0.5, Math.min(width / 1920, height / 1080));
};

export const positionToCanvasSpace = (pos: Position, element: HTMLElement): [number, number, number, number] => {
  const canvasWidth = element.clientWidth;
  const canvasHeight = element.clientHeight;

  const _scale = scale();
  let width = pos.width * _scale;
  if (pos.widthPercentage) {
    width /= 100 * _scale;
    width *= canvasWidth;
  }
  let height = pos.height * _scale;
  if (pos.heightPercentage) {
    height /= 100 * _scale;
    height *= canvasHeight;
  }

  if (pos.minWidth) {
    let minWidth = pos.minWidth;
    if (pos.minWidthPercentage) {
      minWidth /= 100;
      minWidth *= canvasWidth;
    }
    if (width < minWidth) {
      width = minWidth;
    }
  }
  if (pos.maxWidth) {
    let maxWidth = pos.maxWidth;
    if (pos.maxWidthPercentage) {
      maxWidth /= 100;
      maxWidth *= canvasWidth;
    }
    if (width > maxWidth) {
      width = maxWidth;
    }
  }
  if (pos.minHeight) {
    let minHeight = pos.minHeight;
    if (pos.minHeightPercentage) {
      minHeight /= 100;
      minHeight *= canvasHeight;
    }
    if (height < minHeight) {
      height = minHeight;
    }
  }
  if (pos.maxHeight) {
    let maxHeight = pos.maxHeight;
    if (pos.maxHeightPercentage) {
      maxHeight /= 100;
      maxHeight *= canvasHeight;
    }
    if (height > maxHeight) {
      height = maxHeight;
    }
  }

  let xPercentage = typeof pos.x == "number" ? pos.x / 100 : 0;
  let yPercentage = typeof pos.y == "number" ? pos.y / 100 : 0;
  let xOffset = (pos.xOffset || 0) * _scale - width / 2;
  let yOffset = (pos.yOffset || 0) * _scale - height / 2;

  if (pos.x === "center") {
    xPercentage = 0.5;
  } else if (pos.x === "right") {
    xPercentage = 1;
    xOffset += -width / 2;
  } else if (pos.x === "left") {
    xPercentage = 0;
    xOffset += width / 2;
  }

  if (pos.y === "center") {
    yPercentage += 0.5;
  } else if (pos.y === "bottom") {
    yPercentage += 1;
    yOffset += -height / 2;
  } else if (pos.y === "top") {
    yPercentage += 0;
    yOffset += height / 2;
  }

  return [
    pos.x === "full" ? 0 : Math.floor(xPercentage * canvasWidth + xOffset),
    pos.y === "full" ? 0 : Math.floor(yPercentage * canvasHeight + yOffset),
    pos.x === "full" ? document.body.clientWidth : Math.floor(width),
    pos.y === "full" ? document.body.clientHeight : Math.floor(height),
  ];
};

export const scaleFont = (fontSize: number): number => {
  let width = window.innerWidth;
  let height = (window.innerWidth * 9) / 16;
  if (height > window.innerHeight) {
    height = window.innerHeight;
    width = (window.innerHeight * 16) / 9;
  }

  const scale = Math.min(width / 1920, height / 1080);

  return Math.floor(fontSize * Math.max(0.75, scale));
};
