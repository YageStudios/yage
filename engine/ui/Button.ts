import type { GameModel } from "@/game/GameModel";
import type { Position, Rectangle } from "./Rectangle";
import { UIElement } from "./UIElement";
import { BoxConfig } from "./Box";
import { TextConfig } from "./Text";
import { scaleFont } from "./utils";
import { cloneDeep } from "lodash";
import { InputEventType } from "@/inputs/InputManager";

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
  pointerEvents: "auto",
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

  protected onClickInternal(playerIndex: number): void | boolean {
    return this._config.onClick?.(playerIndex);
  }

  protected onMouseDownInternal(playerIndex: number): void | boolean {
    return this._config.onMouseDown?.(playerIndex);
  }

  protected onMouseUpInternal(playerIndex: number): void | boolean {
    return this._config.onMouseUp?.(playerIndex);
  }

  protected onBlurInternal(playerIndex: number): void {
    if (this._config.onBlur) {
      this._config.onBlur(playerIndex);
    }
  }
  protected onFocusInternal(playerIndex: number): void {
    if (this._config.onFocus) {
      this._config.onFocus(playerIndex);
    }
  }
  protected onMouseEnterInternal(playerIndex: number): void {
    if (this._config.onMouseEnter) {
      this._config.onMouseEnter(playerIndex);
    }
  }
  protected onMouseLeaveInternal(playerIndex: number): void {
    if (this._config.onMouseLeave) {
      this._config.onMouseLeave(playerIndex);
    }
  }

  createElement(): HTMLButtonElement {
    const element = document.createElement("button");
    element.id = this.id;
    element.appendChild(this.textElement);
    if (this._config.focusable) {
      element.classList.add("focusable");
    }
    if (this._config.captureFocus !== undefined) {
      element.classList.add("captureFocus" + this._config.captureFocus);
      this.uiService.clearFocusedElementByPlayerIndex(this._config.captureFocus);
    }

    if (this._config.autoEmptyFocus) {
      if (!this.uiService.autoEmptyFocusElements.includes(this)) {
        this.uiService.autoEmptyFocusElements.push(this);
      }
    }
    return element as unknown as HTMLButtonElement;
  }

  protected handleConfigChange(key: string, value: any): void {
    if (this.destroyed) {
      return;
    }
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

    if (!buttonElement) {
      return;
    }

    buttonElement.style.fontSize = `${scaleFont(this.config.fontSize || 12)}px`;
    this.textElement.innerText = this._config.label;
    buttonElement.onclick = (e) => {
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0);
      if (playerIndex === -1) {
        e.stopPropagation();
        return;
      }
      this.onMouseEnter(e, true);

      if (this.onClick(playerIndex) === false) {
        e.stopPropagation();
      }
    };
    buttonElement.onmousedown = (e) => {
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0);
      if (playerIndex === -1) {
        e.stopPropagation();
        return;
      }
      if (this.onMouseDown(playerIndex) === false) {
        e.stopPropagation();
      }
    };
    buttonElement.onmouseup = (e) => {
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0);
      if (playerIndex === -1) {
        e.stopPropagation();
        return;
      }
      if (this.onMouseUp(playerIndex) === false) {
        e.stopPropagation();
      }
    };
    buttonElement.onmouseenter = (e) => {
      this.onMouseEnter(e);
    };
    buttonElement.onmouseleave = () => {
      this.onMouseLeave();
    };
  }
}
