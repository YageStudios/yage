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

  return Math.min(width / 1920, height / 1080);
};

export const positionToCanvasSpace = (pos: Position, element: HTMLElement): [number, number, number, number] => {
  const { width: canvasWidth, height: canvasHeight } = element.getBoundingClientRect();

  let xPercentage = typeof pos.x == "number" ? pos.x / 100 : 0;
  let yPercentage = typeof pos.y == "number" ? pos.y / 100 : 0;
  let xOffset = (pos.xOffset || 0) - pos.width / 2;
  let yOffset = (pos.yOffset || 0) - pos.height / 2;

  if (pos.x === "center") {
    xPercentage = 0.5;
  } else if (pos.x === "right") {
    xPercentage = 1;
    xOffset += -pos.width / 2;
  } else if (pos.x === "left") {
    xPercentage = 0;
    xOffset += pos.width / 2;
  }

  if (pos.y === "center") {
    yPercentage += 0.5;
  } else if (pos.y === "bottom") {
    yPercentage += 1;
    yOffset += -pos.height / 2;
  } else if (pos.y === "top") {
    yPercentage += 0;
    yOffset += pos.height / 2;
  }

  return [
    Math.floor(xPercentage * canvasWidth + xOffset * scale()),
    Math.floor(yPercentage * canvasHeight + yOffset * scale()),
    Math.floor(pos.width * scale()),
    Math.floor(pos.height * scale()),
  ];
  // return new Position(Math.floor(xPercentage * width), Math.floor(yPercentage * height), {
  //   width: Math.floor(pos.width * scale()),
  //   height: Math.floor(pos.height * scale()),
  // });
};

export const rectToCanvasSpace = (rect: Rectangle, element: HTMLElement): Rectangle => {
  const { width, height, top: offsetY, left: offsetX } = element.getBoundingClientRect();

  let xPercentage = (rect.x - offsetX) / 1920;
  let yPercentage = (rect.y - offsetY) / 1080;

  if (rect.justify === "center") {
    xPercentage += 0.5 - (rect.width * scale()) / 2 / window.innerWidth;
  } else if (rect.justify === "right") {
    xPercentage += (width - rect.width * scale()) / window.innerWidth;
  } else if (rect.justify === "left") {
    xPercentage += 0;
  }

  if (rect.align === "center") {
    yPercentage += (height / 2 - (rect.height * scale()) / 2) / 1080;
  } else if (rect.align === "bottom") {
    yPercentage += (height - rect.height * scale()) / 1080;
  } else if (rect.align === "top") {
    yPercentage += 0;
  }

  return new Rectangle(
    Math.floor(xPercentage * width),
    Math.floor(yPercentage * height),
    Math.floor(rect.width * scale()),
    Math.floor(rect.height * scale())
  );
};

export const scaleFont = (fontSize: number): number => {
  let width = window.innerWidth;
  let height = (window.innerWidth * 9) / 16;
  if (height > window.innerHeight) {
    height = window.innerHeight;
    width = (window.innerHeight * 16) / 9;
  }

  const scale = Math.min(width / 1920, height / 1080);

  return Math.floor(fontSize * scale);
};
