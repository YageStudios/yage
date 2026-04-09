import type { Position } from "./Rectangle";
import { Rectangle } from "./Rectangle";
import { UIElement } from "./UIElement";
import type { BoxConfig } from "./Box";
import type { TextConfig } from "./Text";
import { scaleFont } from "./utils";
import { InputEventType } from "yage/inputs/InputManager";

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
  editingPlayerIndex: number | null = null;
  editingStartValue: string = "";

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

  private startEditing(playerIndex: number, selectContents = false): boolean {
    if (this.editingPlayerIndex === playerIndex) {
      return true;
    }
    this.editingStartValue = this._config.value || "";
    this.editingPlayerIndex = playerIndex;
    this.uiService.setFocusedElementByPlayerIndex(playerIndex, this);
    this.focusTime = Date.now();
    if (this._element) {
      this._element.readOnly = false;
    }
    this.update();
    requestAnimationFrame(() => {
      this.element?.focus();
      if (selectContents) {
        this.element?.select();
        return;
      }
      const valueLength = this.element?.value.length ?? 0;
      this.element?.setSelectionRange(valueLength, valueLength);
    });
    return true;
  }

  private stopEditing(options?: { revert?: boolean; submit?: boolean }): void {
    const previousValue = this._config.value || "";
    if (options?.revert) {
      this._config.value = this.editingStartValue;
      if (previousValue !== this.editingStartValue) {
        this._config.onChange?.(this.editingStartValue);
      }
    }
    if (options?.submit) {
      this._config.onSubmit?.(this._config.value || "");
    }
    this.focusTime = -1;
    this.editingPlayerIndex = null;
    if (this._element) {
      this._element.readOnly = true;
      const valueLength = this._element.value.length;
      this._element.setSelectionRange(valueLength, valueLength);
    }
    this.element?.blur();
    this.update();
  }

  protected onClickInternal(playerIndex: number): void | boolean {
    if (this._config.onClick) {
      return this._config.onClick(playerIndex);
    }
    return this.startEditing(playerIndex, true);
  }

  protected onMouseDownInternal(playerIndex: number): void | boolean {
    this.startEditing(playerIndex, true);
    if (this._config.onMouseDown) {
      return this._config.onMouseDown(playerIndex);
    }
  }

  protected onMouseUpInternal(playerIndex: number): void | boolean {
    if (this._config.onMouseUp) {
      return this._config.onMouseUp(playerIndex);
    }
  }

  protected onBlurInternal(playerIndex: number): void {
    if (this.editingPlayerIndex === playerIndex) {
      this.stopEditing();
    }
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

  onDestroy(noUpdate?: boolean): void {
    super.onDestroy(noUpdate);
  }

  onEscape(playerIndex: number): void {
    if (this.editingPlayerIndex === playerIndex) {
      this.stopEditing({ revert: true });
      this.uiService.setFocusedElementByPlayerIndex(playerIndex, this);
      return;
    }
    super.onEscape(playerIndex);
  }

  capturesTextInput(playerIndex: number): boolean {
    return this.editingPlayerIndex === playerIndex;
  }

  beginTextInput(playerIndex: number): boolean {
    return this.startEditing(playerIndex, true);
  }

  handleTextInputKey(playerIndex: number, key: string): boolean {
    if (this.editingPlayerIndex !== playerIndex) {
      return false;
    }

    if (key === "Backspace") {
      this._config.value = this._config.value?.substring(0, this._config.value.length - 1) || "";
      this._config.onChange?.(this._config.value || "");
      this.update();
      return true;
    }

    if (key === "Enter") {
      this.stopEditing({ submit: true });
      this.uiService.setFocusedElementByPlayerIndex(playerIndex, this);
      return true;
    }

    if (key.length === 1) {
      this._config.value = (this._config.value || "") + key;
      this._config.onChange?.(this._config.value || "");
      this.update();
      return true;
    }

    return true;
  }

  createElement(): HTMLInputElement {
    const element = document.createElement("input");
    element.id = this.id;
    if (this._config.focusable) {
      element.classList.add("focusable");
    }
    if (this._config.captureFocus !== undefined && this._config.captureFocus > -1) {
      element.classList.add("captureFocus" + this._config.captureFocus);
      this.uiService.clearFocusedElementByPlayerIndex(this._config.captureFocus);
    }
    if (this._config.autoFocus) {
      element.classList.add("autoFocus");
    }
    return element;
  }

  _update(): void {
    super._update();
    if (!this.isVisible()) {
      return;
    }

    const textInputElement = this.element;
    if (!textInputElement) {
      return;
    }
    textInputElement.type = "text";
    textInputElement.placeholder = this._config.label;

    textInputElement.style.backgroundColor = this._config.style.backgroundColor ?? "transparent";
    textInputElement.style.fontFamily = this._config.font ?? this._config.style.fontFamily ?? "YageFont";
    textInputElement.style.color = "white";
    textInputElement.style.border = `1px solid ${this._config.style.borderColor ?? "white"}`;
    textInputElement.value = this._config.value || "";
    textInputElement.readOnly = this.editingPlayerIndex === null;
    const scales = this.getScales();
    textInputElement.style.fontSize = `${scaleFont(this.config.fontSize || 12, scales[0] * scales[1] * scales[2])}px`;

    textInputElement.onmousedown = (e) => {
      const playerIndex = this.getSharedInteractionPlayerIndex(InputEventType.MOUSE);
      if (playerIndex === -1) {
        e.stopPropagation();
        return;
      }
      this.startEditing(playerIndex, true);
    };

    textInputElement.onclick = (e) => {
      const playerIndex = this.getSharedInteractionPlayerIndex(InputEventType.MOUSE);
      if (playerIndex === -1) {
        e.stopPropagation();
        return;
      }
      this.startEditing(playerIndex, true);
      e.stopPropagation();
    };

    textInputElement.onkeyup = () => {
      if (this.editingPlayerIndex === null) {
        textInputElement.value = this._config.value || "";
        return;
      }
      this._config.value = textInputElement.value;
      this._config.onChange?.(this._config.value);
    };

    textInputElement.onkeydown = (e) => {
      if (this.editingPlayerIndex === null) {
        return;
      }
      const editingPlayerIndex = this.editingPlayerIndex;
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this._config.value = textInputElement.value;
        this.stopEditing({ submit: true });
        this.uiService.setFocusedElementByPlayerIndex(editingPlayerIndex, this);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        this.stopEditing({ revert: true });
        textInputElement.value = this._config.value || "";
        this.uiService.setFocusedElementByPlayerIndex(editingPlayerIndex, this);
      }
    };

    textInputElement.oninput = () => {
      if (this.editingPlayerIndex === null) {
        textInputElement.value = this._config.value || "";
        return;
      }
      this._config.value = textInputElement.value;
      this._config.onChange?.(this._config.value);
    };
  }
}
