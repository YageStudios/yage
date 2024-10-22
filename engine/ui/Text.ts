import type { GameModel } from "yage/game/GameModel";
import { Rectangle } from "./Rectangle";
import { Position } from "./Rectangle";
import type { UIElementConfig } from "./UIElement";
import { UIElement } from "./UIElement";
import { scaleFont } from "./utils";

export type TextConfig = UIElementConfig & {
  label: string;
  fontSize?: number;
  font?: string;
  scrollable?: boolean;
};

const defaultStyle: Partial<CSSStyleDeclaration> = {
  textAlign: "center",
  color: "white",
  backgroundColor: "transparent",
  border: "none",
  padding: "0",
  margin: "0",
  pointerEvents: "none",
  userSelect: "none",
  overflow: "visible",
  position: "absolute",
  fontFamily: "YageFont",
};

function measureText(text: string, fontSize: number, font: string = "YageFont"): { width: number; height: number } {
  const measurer = document.createElement("span");
  measurer.style.fontSize = `${fontSize}px`;
  measurer.style.fontFamily = font;
  measurer.style.position = "absolute";
  measurer.style.left = "-9999px";
  measurer.style.whiteSpace = "nowrap";

  if (text.trim().startsWith("<")) {
    measurer.innerHTML = text;
  } else {
    measurer.textContent = text;
  }

  document.body.appendChild(measurer);
  const dimensions = {
    width: measurer.offsetWidth,
    height: measurer.offsetHeight,
  };
  document.body.removeChild(measurer);

  return dimensions;
}

export class Text extends UIElement<TextConfig> {
  private autoWidth: boolean = false;
  private autoHeight: boolean = false;

  constructor(bounds: Position, config: Partial<TextConfig>);
  constructor(bounds: Rectangle, config: Partial<TextConfig>);
  constructor(bounds: [number, number], config: Partial<TextConfig>);
  constructor(bounds: Position | Rectangle | [number, number], config: Partial<TextConfig>) {
    let autoWidth = false;
    let autoHeight = false;
    if (Array.isArray(bounds)) {
      bounds = new Position(bounds[0], bounds[1], { width: 0, height: 0 });
    }

    if (bounds instanceof Position) {
      // Set auto-size flags based on initial dimensions
      autoWidth = bounds.width === 0;
      autoHeight = bounds.height === 0;

      if (autoWidth || autoHeight) {
        const fontSize = config.fontSize || 12;
        const label = config.label || "";
        const measured = measureText(label, fontSize, config.font);

        bounds.width = autoWidth ? measured.width : bounds.width;
        bounds.height = autoHeight ? measured.height : bounds.height;
      }
    }

    super(bounds, { label: "", ...config }, defaultStyle);
    this.autoWidth = autoWidth;
    this.autoHeight = autoHeight;
  }

  set position(value: Position | Rectangle) {
    if (value instanceof Position) {
      // Update auto-size flags if explicit dimensions are set
      if (value.width > 0) this.autoWidth = false;
      if (value.height > 0) this.autoHeight = false;
    }

    // Convert Rectangle to Position if needed
    this.bounds = value instanceof Rectangle ? value.toPosition() : value;
    this.update();
  }

  get position() {
    return new Proxy(this.bounds, {
      set: (target: any, key, value) => {
        target[key] = value;
        this.update();
        return true;
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected onClickInternal(): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected onMouseDownInternal(): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected onMouseUpInternal(): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected onBlurInternal(): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected onFocusInternal(): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected onMouseEnterInternal(): void {}

  // eslint-disable-next-line @typescript-eslint/no-empty-function
  protected onMouseLeaveInternal(): void {}

  protected updateInternal(gameModel: GameModel): void {}

  protected handleConfigChange(key: string, value: any): void {
    if (this.destroyed) {
      return;
    }

    if (key === "label" || key === "fontSize") {
      if (key === "label") {
        this._config.label = value;
        if (typeof value === "string" && value.trim().startsWith("<")) {
          this.element.innerHTML = value;
        } else if (value === undefined) {
          this.element.innerText = "";
        } else {
          this.element.innerText = value;
        }
      } else {
        this._config.fontSize = value;
      }

      // Only recalculate auto-sized dimensions
      if (this.autoWidth || this.autoHeight) {
        const bounds = this.bounds;
        if (bounds instanceof Position) {
          const fontSize = this._config.fontSize || 12;
          const label = this._config.label || "";
          const measured = measureText(label, fontSize, this._config.font);

          if (this.autoWidth) bounds.width = measured.width;
          if (this.autoHeight) bounds.height = measured.height;
        }
      }

      const scales = this.getScales();
      this.element.style.fontSize = `${scaleFont(this.config.fontSize || 12, scales[0] * scales[1] * scales[2])}px`;
      return;
    }

    if (key === "scrollable") {
      this._config.scrollable = value;
      this.element.style.overflow = value ? "auto" : "visible";
      return;
    }

    super.handleConfigChange(key, value);
  }

  _update(): void {
    super._update();
    if (!this.isVisible()) {
      return;
    }
    const textElement = this.element;
    if (!textElement) {
      return;
    }

    const scales = this.getScales();
    textElement.style.fontSize = `${scaleFont(this.config.fontSize || 12, scales[0] * scales[1] * scales[2])}px`;

    if (typeof this._config.label === "string" && this._config.label.trim().startsWith("<")) {
      textElement.innerHTML = this._config.label;
    } else if (this._config.label === undefined) {
      textElement.innerText = "";
    } else {
      textElement.innerText = this._config.label;
    }

    if (this._config.scrollable) {
      textElement.style.pointerEvents = "auto";
      textElement.style.overflow = "auto";
    }
  }
}
