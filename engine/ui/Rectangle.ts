export class Position {
  x: number | "left" | "center" | "right";
  y: number | "top" | "center" | "bottom";

  xOffset: number = 0;
  yOffset: number = 0;

  width: number = 0;
  height: number = 0;

  constructor(
    x: number | "left" | "center" | "right",
    y: number | "top" | "center" | "bottom",
    { width, height, xOffset, yOffset }: { width?: number; height?: number; xOffset?: number; yOffset?: number } = {}
  ) {
    this.x = x;
    this.y = y;
    this.width = width || this.width;
    this.height = height || this.height;
    this.xOffset = xOffset || this.xOffset;
    this.yOffset = yOffset || this.yOffset;
  }
}

export const isRectangle = (rect: Rectangle | Position): rect is Rectangle => {
  if ((rect as Rectangle).left !== undefined) {
    return true;
  }
  return false;
};

export class Rectangle {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  x: number;
  y: number;

  justify: "left" | "center" | "right" | undefined;
  align: "top" | "center" | "bottom" | undefined;

  constructor(rect: { x: number; y: number; width: number; height: number });
  constructor(left: number, top: number, width: number, height: number);
  constructor(
    left: number | { x: number; y: number; width: number; height: number },
    top?: number,
    width?: number,
    height?: number
  ) {
    if (typeof left === "object") {
      this.set(left.x, left.y, left.width, left.height);
    } else {
      this.set(left, top!, width!, height!);
    }
  }

  private set(left: number, top: number, width?: number, height?: number) {
    this.x = left;
    this.y = top;
    this.left = left;
    this.top = top;
    this.width = width || this.width;
    this.height = height || this.height;
    this.right = this.left + this.width;
    this.bottom = this.top + this.height;
  }

  toPosition(): Position {
    let x = (this.x / 1920) * 100;
    let y = (this.y / 1080) * 100;
    return new Position(this.justify || x, this.align || y, { width: this.width, height: this.height });
  }
}
