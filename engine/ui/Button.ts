import type { GameModel } from "@/game/GameModel";
import type { Position, Rectangle } from "./Rectangle";
import { UIElement } from "./UIElement";
import { BoxConfig } from "./Box";
import { TextConfig } from "./Text";
import { scaleFont } from "./utils";
import { cloneDeep } from "lodash";

export interface ButtonConfig extends BoxConfig, TextConfig {
  hoverStyle?: Partial<CSSStyleDeclaration>;
}

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
  overflow: "visible",
  justifyContent: "center",
  textShadow: "1px 1px 4px black",
};

export class Button extends UIElement<ButtonConfig> {
  protected _hasChanged = true;
  textElement: HTMLSpanElement = document.createElement("span");

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

  protected onBlurInternal(): void {
    if (this._config.onBlur) {
      this._config.onBlur();
    }
  }
  protected onFocusInternal(): void {
    if (this._config.onFocus) {
      this._config.onFocus();
    }
  }
  protected onMouseEnterInternal(): void {
    if (this._config.onMouseEnter) {
      this._config.onMouseEnter();
    }
    this._styleOverrides = cloneDeep(this._config.hoverStyle);
  }
  protected onMouseLeaveInternal(): void {
    if (this._config.onMouseLeave) {
      this._config.onMouseLeave();
    }
    this._styleOverrides = undefined;
    this._hasChanged = true;
  }

  createElement(): HTMLButtonElement {
    const element = document.createElement("button");
    element.id = this.id;
    element.appendChild(this.textElement);
    return element as unknown as HTMLButtonElement;
  }

  update(): void {
    super.update();

    const buttonElement = this.element;
    if (this._config.uppercase) {
      buttonElement.style.textTransform = "uppercase";
    }

    buttonElement.style.fontSize = `${scaleFont(this.config.fontSize || 12)}px`;
    this.textElement.innerText = this._config.label;

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
    buttonElement.onfocus = () => {
      this.onFocusInternal();
    };
    buttonElement.onmouseenter = () => {
      this.onMouseEnterInternal();
    };
    buttonElement.onmouseleave = () => {
      this.onMouseLeaveInternal();
    };
  }
}
