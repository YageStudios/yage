/* eslint-disable @typescript-eslint/no-unused-vars */
import type { GameModel } from "@/game/GameModel";
import { Position, Rectangle } from "./Rectangle";
import { UIElement, UIElementConfig } from "./UIElement";
import { scaleFont } from "./utils";

export type TextConfig = UIElementConfig & {
  label: string;
  uppercase?: boolean;
  fontSize?: number;
  font?: string;
  multiline?: boolean;
};

const defaultStyle: Partial<CSSStyleDeclaration> = {
  textAlign: "center",
  color: "white",
  backgroundColor: "transparent",
  border: "none",
  padding: "0",
  margin: "0",
  pointerEvents: "none",
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

  protected updateInternal(gameModel: GameModel): void {}

  protected drawInternal(ctx: CanvasRenderingContext2D, ui: HTMLDivElement): void {
    const textElement = this._element ?? document.createElement("div");

    if (this._config.multiline) {
      textElement.style.whiteSpace = "pre";
      textElement.style.lineHeight = `${this._config.style.lineHeight ?? 1}`;
    }

    if (this._config.uppercase) {
      textElement.style.textTransform = "uppercase";
    }
    textElement.style.fontSize = `${scaleFont(this._config.fontSize ?? 12)}px`;
    textElement.innerText = this._config.label;

    if (!this._element) {
      ui.appendChild(textElement);
      this._element = textElement;
    }
  }
}
