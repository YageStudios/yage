export type Size = `${number}%` | `${number}px` | `${number}in` | number | "auto" | "full";

//calculate inches to pixels
const inchesToPixels = (inches: string) => Math.floor(parseFloat(inches.replace("in", "")) * 96);

export class Position {
  x: number | "left" | "center" | "right" | "full";
  y: number | "top" | "center" | "bottom" | "full";

  xOffset: number = 0;
  yOffset: number = 0;

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
      xOffset?: number;
      yOffset?: number;
      minWidth?: Size;
      minHeight?: Size;
      maxWidth?: Size;
      maxHeight?: Size;
    } = {}
  ) {
    this.x = x;
    this.y = y;
    if (typeof width === "string") {
      if (width.includes("%")) {
        this.width = parseFloat(width.replace("%", ""));
        this.widthPercentage = true;
      } else if (width.includes("in")) {
        this.width = inchesToPixels(width);
      }
    } else {
      this.width = width || this.width;
    }
    if (typeof height === "string") {
      if (height.includes("%")) {
        this.height = parseFloat(height.replace("%", ""));
        this.heightPercentage = true;
      } else if (height.includes("in")) {
        this.height = inchesToPixels(height);
      }
    } else {
      this.height = height || this.height;
    }
    if (minWidth) {
      if (typeof minWidth === "string") {
        if (minWidth.includes("%")) {
          this.minWidth = parseFloat(minWidth.replace("%", ""));
          this.minWidthPercentage = true;
        } else if (minWidth.includes("in")) {
          this.minWidth = inchesToPixels(minWidth);
        }
      } else {
        this.minWidth = minWidth;
      }
    }
    if (minHeight) {
      if (typeof minHeight === "string") {
        if (minHeight.includes("%")) {
          this.minHeight = parseFloat(minHeight.replace("%", ""));
          this.minHeightPercentage = true;
        } else if (minHeight.includes("in")) {
          this.minHeight = inchesToPixels(minHeight);
        }
      } else {
        this.minHeight = minHeight;
      }
    }
    if (maxWidth) {
      if (typeof maxWidth === "string") {
        if (maxWidth.includes("%")) {
          this.maxWidth = parseFloat(maxWidth.replace("%", ""));
          this.maxWidthPercentage = true;
        } else if (maxWidth.includes("in")) {
          this.maxWidth = inchesToPixels(maxWidth);
        }
      } else {
        this.maxWidth = maxWidth;
      }
    }
    if (maxHeight) {
      if (typeof maxHeight === "string") {
        if (maxHeight.includes("%")) {
          this.maxHeight = parseFloat(maxHeight.replace("%", ""));
          this.maxHeightPercentage = true;
        } else if (maxHeight.includes("in")) {
          this.maxHeight = inchesToPixels(maxHeight);
        }
      } else {
        this.maxHeight = maxHeight;
      }
    }

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
    let x = (this.x / 1920) * 100;
    let y = (this.y / 1080) * 100;
    return new Position(this.justify || x, this.align || y, { width: this.width, height: this.height });
  }
}
