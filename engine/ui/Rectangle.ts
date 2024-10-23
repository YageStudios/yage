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
    } else if (size === "auto") {
      size = -1;
    } else if (size === "full") {
      size = -2;
    } else {
      size = parseFloat(size);
    }
  }
  return [size as number, isPercentage];
};

export class Position {
  private _x: number | "left" | "center" | "right" | "full";
  private _y: number | "top" | "center" | "bottom" | "full";
  private _xOffset: number = 0;
  xOffsetPercentage: boolean = false;
  private _yOffset: number = 0;
  yOffsetPercentage: boolean = false;
  private _width: number = 0;
  widthPercentage: boolean = false;
  private _height: number = 0;
  heightPercentage: boolean = false;
  private _minWidth: number = 0;
  minWidthPercentage: boolean = false;
  private _minHeight: number = 0;
  minHeightPercentage: boolean = false;
  private _maxWidth: number = 0;
  maxWidthPercentage: boolean = false;
  private _maxHeight: number = 0;
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
    this._x = x;
    this._y = y;
    this.width = width || this._width;
    this.height = height || this._height;
    this.minWidth = minWidth || this._minWidth;
    this.minHeight = minHeight || this._minHeight;
    this.maxWidth = maxWidth || this._maxWidth;
    this.maxHeight = maxHeight || this._maxHeight;
    this.xOffset = xOffset || this._xOffset;
    this.yOffset = yOffset || this._yOffset;
  }

  // Getters
  get x() {
    return this._x;
  }
  get y() {
    return this._y;
  }
  get xOffset(): number {
    return this._xOffset;
  }
  get yOffset(): number {
    return this._yOffset;
  }
  get width(): number {
    return this._width;
  }
  get height(): number {
    return this._height;
  }
  get minWidth(): number {
    return this._minWidth;
  }
  get minHeight(): number {
    return this._minHeight;
  }
  get maxWidth(): number {
    return this._maxWidth;
  }
  get maxHeight(): number {
    return this._maxHeight;
  }

  // Setters
  set x(value: number | "left" | "center" | "right" | "full") {
    this._x = value;
  }
  set y(value: number | "top" | "center" | "bottom" | "full") {
    this._y = value;
  }

  set width(size: Size) {
    [this._width, this.widthPercentage] = sizeToPixels(size);
  }

  set height(size: Size) {
    [this._height, this.heightPercentage] = sizeToPixels(size);
  }

  set xOffset(size: Size) {
    [this._xOffset, this.xOffsetPercentage] = sizeToPixels(size);
  }

  set yOffset(size: Size) {
    [this._yOffset, this.yOffsetPercentage] = sizeToPixels(size);
  }

  set minWidth(size: Size) {
    [this._minWidth, this.minWidthPercentage] = sizeToPixels(size);
  }

  set minHeight(size: Size) {
    [this._minHeight, this.minHeightPercentage] = sizeToPixels(size);
  }

  set maxWidth(size: Size) {
    [this._maxWidth, this.maxWidthPercentage] = sizeToPixels(size);
  }

  set maxHeight(size: Size) {
    [this._maxHeight, this.maxHeightPercentage] = sizeToPixels(size);
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
