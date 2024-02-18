import type { GameModel } from "@/game/GameModel";
import { Position, Rectangle } from "./Rectangle";
import { UIElement } from "./UIElement";
import { BoxConfig } from "./Box";
import { TextConfig } from "./Text";
import { positionToCanvasSpace, scaleFont } from "./utils";

export interface TextInputConfig extends BoxConfig, TextConfig {
  value?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
}

const defaultStyle: Partial<CSSStyleDeclaration> = {
  color: "white",
  backgroundColor: "transparent",
  padding: "0 1%",
  margin: "0",
  position: "absolute",
  fontFamily: "YageFont",
};

export class TextInput extends UIElement<TextInputConfig> {
  focusTime: number = 0;

  _element: HTMLInputElement | undefined = undefined;

  constructor(bounds: Rectangle, config: Partial<TextInputConfig>);
  constructor(bounds: Position, config: Partial<TextInputConfig>);
  constructor(bounds: [number, number], config: Partial<TextInputConfig>);
  constructor(bounds: Rectangle | Position | [number, number], config: Partial<TextInputConfig>) {
    if (Array.isArray(bounds)) {
      bounds = new Rectangle(bounds[0], bounds[1], 0, 0);
    }
    super(bounds, config, defaultStyle);
  }

  protected onClickInternal(): void | boolean {
    if (this._config.onClick) {
      return this._config.onClick();
    }
    this.focusTime = +new Date();
    document.addEventListener("keydown", this.listenKeyPress);
  }

  listenKeyPress = (e: any) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Backspace") {
      this._config.value = this._config.value?.substring(0, this._config.value.length - 1) || "";
    } else if (e.key.length === 1) {
      this._config.value = (this._config.value || "") + e.key;
    } else if (e.key === "Enter") {
      this._config.onSubmit?.(this._config.value || "");
      return;
    }
    this._config.onChange?.(this._config.value || "");
  };

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
    this.focusTime = -1;
    document.removeEventListener("keydown", this.listenKeyPress);
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

  onDestroy(): void {
    super.onDestroy();
    document.removeEventListener("keydown", this.listenKeyPress);
  }

  createElement(): HTMLInputElement {
    const element = document.createElement("input");
    element.id = this.id;
    return element;
  }

  _update(): void {
    super._update();
    if (!this.isVisible()) {
      return;
    }

    const textInputElement = this.element;
    textInputElement.type = "text";
    textInputElement.placeholder = this._config.label;

    textInputElement.style.backgroundColor = this._config.style.backgroundColor ?? "transparent";
    textInputElement.style.fontFamily = this._config.font ?? this._config.style.fontFamily ?? "YageFont";
    textInputElement.style.color = "white";
    textInputElement.style.border = `1px solid ${this._config.style.borderColor ?? "white"}`;
    textInputElement.value = this._config.value || "";
    textInputElement.style.fontSize = `${scaleFont(this._config.fontSize ?? 12)}px`;

    textInputElement.onkeyup = (e) => {
      this._config.value = textInputElement.value;
      this._config.onChange?.(this._config.value);
    };

    textInputElement.onkeydown = (e) => {
      if (e.key === "Enter") {
        this._config.onSubmit?.(textInputElement.value);
      }
    };
  }
}
