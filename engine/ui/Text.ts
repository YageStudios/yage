/* eslint-disable @typescript-eslint/no-unused-vars */
import type { GameModel } from "@/game/GameModel";
import { Position, Rectangle } from "./Rectangle";
import { UIElement, UIElementConfig } from "./UIElement";
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

export class Text extends UIElement<TextConfig> {
  constructor(bounds: Position, config: Partial<TextConfig>);
  constructor(bounds: Rectangle, config: Partial<TextConfig>);
  constructor(bounds: [number, number], config: Partial<TextConfig>);
  constructor(bounds: Position | Rectangle | [number, number], config: Partial<TextConfig>) {
    if (Array.isArray(bounds)) {
      bounds = new Position(bounds[0], bounds[1], { width: 0, height: 0 });
    }
    super(bounds, config, defaultStyle);
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
    if (!this.element) {
      return;
    }
    if (key === "label") {
      this._config.label = value;
      if (typeof this._config.label === "string" && value.trim().startsWith("<")) {
        this.element.innerHTML = value;
      } else if (this._config.label === undefined) {
        this.element.innerText = "";
      } else {
        this.element.innerText = value;
      }
      return;
    }
    if (key === "fontSize") {
      this._config.fontSize = value;
      this.element.style.fontSize = `${scaleFont(value)}px`;
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

    textElement.style.fontSize = `${scaleFont(this._config.fontSize ?? 12)}px`;
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
