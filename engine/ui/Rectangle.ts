export type Size = `${number}%` | `${number}px` | `${number}in` | number | "auto" | "full";

//calculate inches to pixels
const inchesToPixels = (inches: string) => Math.floor(parseFloat(inches.replace("in", "")) * 96);

const sizeToPixels = (size: Size): [number, boolean] => {
  let isPercentage = false;
  if (typeof size === "string") {
    if (size.includes("%")) {
      size = parseFloat(size.replace("%", ""));
      isPercentage = true;
    } else if (size.includes("in")) {
      size = inchesToPixels(size);
    } else if (size.endsWith("px")) {
      size = parseFloat(size.replace("px", ""));
    } else {
      size = parseFloat(size);
    }
  }
  return [size as number, isPercentage];
};

export class Position {
  x: number | "left" | "center" | "right" | "full";
  y: number | "top" | "center" | "bottom" | "full";

  xOffset: number = 0;
  xOffsetPercentage: boolean = false;
  yOffset: number = 0;
  yOffsetPercentage: boolean = false;

  width: number = 0;
  widthPercentage: boolean = false;
  height: number = 0;
  heightPercentage: boolean = false;

  minWidth: number = 0;
  minWidthPercentage: boolean = false;
  minHeight: number = 0;
  minHeightPercentage: boolean = false;

  maxWidth: number = 0;
  maxWidthPercentage: boolean = false;
  maxHeight: number = 0;
  maxHeightPercentage: boolean = false;

  constructor(
    x: number | "left" | "center" | "right" | "full",
    y: number | "top" | "center" | "bottom" | "full",
    {
      width,
      height,
      xOffset,
      yOffset,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
    }: {
      width?: Size;
      height?: Size;
      xOffset?: Size;
      yOffset?: Size;
      minWidth?: Size;
      minHeight?: Size;
      maxWidth?: Size;
      maxHeight?: Size;
    } = {}
  ) {
    this.x = x;
    this.y = y;
    [this.width, this.widthPercentage] = sizeToPixels(width || this.width);
    [this.height, this.heightPercentage] = sizeToPixels(height || this.height);
    [this.minWidth, this.minWidthPercentage] = sizeToPixels(minWidth || this.minWidth);
    [this.minHeight, this.minHeightPercentage] = sizeToPixels(minHeight || this.minHeight);
    [this.maxWidth, this.maxWidthPercentage] = sizeToPixels(maxWidth || this.maxWidth);
    [this.maxHeight, this.maxHeightPercentage] = sizeToPixels(maxHeight || this.maxHeight);
    [this.xOffset, this.xOffsetPercentage] = sizeToPixels(xOffset || this.xOffset);
    [this.yOffset, this.yOffsetPercentage] = sizeToPixels(yOffset || this.yOffset);
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

  justify: "left" | "center" | "right" | "full" | undefined;
  align: "top" | "center" | "bottom" | "full" | undefined;

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
    const x = (this.x / 1920) * 100;
    const y = (this.y / 1080) * 100;
    return new Position(this.justify || x, this.align || y, { width: this.width, height: this.height });
  }
}
