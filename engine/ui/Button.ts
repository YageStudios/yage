import type { GameModel } from "@/game/GameModel";
import type { Position, Rectangle } from "./Rectangle";
import { UIElement } from "./UIElement";
import { BoxConfig } from "./Box";
import { TextConfig } from "./Text";
import { rectToCanvasSpace, scaleFont } from "./utils";

export interface ButtonConfig extends BoxConfig, TextConfig {}

const defaultStyle: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  color: "white",
  fontFamily: "YageFont",
  fontSize: `12px`,
  borderStyle: "solid",
  borderWidth: "1px",
  outline: "none",
  cursor: "pointer",
  textAlign: "center",
  padding: "0",
  margin: "0",
  fontWeight: "bold",
  fontStyle: "normal",
  textDecoration: "none",
  display: "flex",
  alignItems: "center",
  overflow: "hidden",
  justifyContent: "center",
  textShadow: "1px 1px 4px black",
};

export class Button extends UIElement<ButtonConfig> {
  protected _hasChanged = true;

  constructor(bounds: Rectangle | Position, config: Partial<ButtonConfig>) {
    super(bounds, config, defaultStyle);
  }

  protected onClickInternal(): void | boolean {
    if (this._config.onClick) {
      return this._config.onClick();
    }
  }

  protected onMouseDownInternal(): void | boolean {
    if (this._config.onMouseDown) {
      return this._config.onMouseDown();
    }
  }

  protected onMouseUpInternal(): void | boolean {
    if (this._config.onMouseUp) {
      return this._config.onMouseUp();
    }
  }

  protected onBlurInternal(): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  protected updateInternal(gameModel: GameModel): void {}

  protected drawInternal(ctx: CanvasRenderingContext2D, ui: HTMLElement): void {
    const buttonElement = this._element ?? document.createElement("button");
    if (this._config.uppercase) {
      buttonElement.style.textTransform = "uppercase";
    }

    buttonElement.style.fontSize = `${scaleFont(this.config.fontSize || 12)}px`;
    buttonElement.innerText = this._config.label;

    buttonElement.onclick = () => {
      this.onClickInternal();
    };
    buttonElement.onmousedown = () => {
      this.onMouseDownInternal();
    };
    buttonElement.onmouseup = () => {
      this.onMouseUpInternal();
    };
    buttonElement.onblur = () => {
      this.onBlurInternal();
    };

    if (!this._element) {
      ui.appendChild(buttonElement);
      this._element = buttonElement;
    }
  }
}
