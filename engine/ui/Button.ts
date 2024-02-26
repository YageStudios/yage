import type { GameModel } from "@/game/GameModel";
import type { Position, Rectangle } from "./Rectangle";
import { UIElement } from "./UIElement";
import { BoxConfig } from "./Box";
import { TextConfig } from "./Text";
import { scaleFont } from "./utils";
import { cloneDeep } from "lodash";

export interface ButtonConfig extends BoxConfig, TextConfig {
  focusStyle?: Partial<CSSStyleDeclaration>;
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
  userSelect: "none",
};

export class Button extends UIElement<ButtonConfig> {
  protected _hasChanged = true;
  textElement: HTMLSpanElement = document.createElement("span");

  constructor(bounds: Rectangle | Position, config: Partial<ButtonConfig>) {
    super(
      bounds,
      {
        focusStyle: {
          outline: "2px solid #2FA6FF",
        },
        focusable: true,
        ...config,
      },
      defaultStyle
    );
  }

  protected onClickInternal(): void | boolean {
    return this._config.onClick?.();
  }

  protected onMouseDownInternal(): void | boolean {
    return this._config.onMouseDown?.();
  }

  protected onMouseUpInternal(): void | boolean {
    return this._config.onMouseUp?.();
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
  }
  protected onMouseLeaveInternal(): void {
    if (this._config.onMouseLeave) {
      this._config.onMouseLeave();
    }
  }

  createElement(): HTMLButtonElement {
    const element = document.createElement("button");
    element.id = this.id;
    element.appendChild(this.textElement);
    if (this._config.focusable) {
      element.classList.add("focusable");
    }
    if (this._config.captureFocus) {
      element.classList.add("captureFocus");
    }
    return element as unknown as HTMLButtonElement;
  }

  protected handleConfigChange(key: string, value: any): void {
    if (key === "label") {
      this._config.label = value;
      this.textElement.innerText = value;
      return;
    }
    if (key === "fontSize") {
      this._config.fontSize = value;
      this.element.style.fontSize = `${scaleFont(value)}px`;
      return;
    }
    super.handleConfigChange(key, value);
  }

  _update(): void {
    super._update();
    if (!this.isVisible()) {
      return;
    }

    const buttonElement = this.element;

    buttonElement.style.fontSize = `${scaleFont(this.config.fontSize || 12)}px`;
    this.textElement.innerText = this._config.label;
    buttonElement.onclick = (e) => {
      if (this.onClick() === false) {
        e.stopPropagation();
      }
    };
    buttonElement.onmousedown = (e) => {
      if (this.onMouseDown() === false) {
        e.stopPropagation();
      }
    };
    buttonElement.onmouseup = (e) => {
      if (this.onMouseUp() === false) {
        e.stopPropagation();
      }
    };
    buttonElement.onblur = () => {
      this.onBlur();
    };
    buttonElement.onfocus = () => {
      this.onFocus();
    };
    buttonElement.onmouseenter = (e) => {
      this.onMouseEnter(e);
    };
    buttonElement.onmouseleave = () => {
      this.onMouseLeave();
    };
  }
}
