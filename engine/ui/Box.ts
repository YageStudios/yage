import type { GameModel } from "@/game/GameModel";
import type { Position, Rectangle } from "./Rectangle";
import { UIElement, UIElementConfig } from "./UIElement";

export type BoxConfig = UIElementConfig & {
  onClick?: (playerIndex: number) => boolean | void;
  onMouseDown?: (playerIndex: number) => boolean | void;
  onMouseUp?: (playerIndex: number) => boolean | void;
  onBlur?: (playerIndex: number) => void;
  onFocus?: (playerIndex: number) => void;
  onMouseEnter?: (playerIndex: number) => void;
  onMouseLeave?: (playerIndex: number) => void;
  style?: Partial<CSSStyleDeclaration>;
  breakoutOverflow?: boolean;
  pointerEventsOnOverflow?: boolean;
};

const defaultStyle: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  textAlign: "center",
  color: "white",
  backgroundColor: "transparent",
  border: "0px solid black",
  padding: "0",
  margin: "0",
  overflow: "visible",
};

export class Box<T extends BoxConfig = BoxConfig> extends UIElement<T> {
  protected _hasChanged = true;

  constructor(bounds: Rectangle | Position, config: Partial<T> = {}) {
    super(bounds, { pointerEventsOnOverflow: true, ...config }, defaultStyle);
  }

  protected onClickInternal(playerIndex: number): void | boolean {
    return this._config.onClick?.(playerIndex);
  }

  protected onMouseDownInternal(playerIndex: number): void | boolean {
    return this._config.onMouseDown?.(playerIndex);
  }

  protected onBlurInternal(playerIndex: number): void {
    if (this._config.onBlur) {
      this._config.onBlur(playerIndex);
    }
  }

  protected onMouseUpInternal(playerIndex: number): void | boolean {
    return this._config.onMouseUp?.(playerIndex);
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

  createElement(): HTMLElement {
    const element = super.createElement();
    element!.onscroll = (e) => {
      const fixedChildren = element.querySelectorAll(".breakout-overflow");
      for (const child of fixedChildren) {
        (child as HTMLElement).style.transform = `translate(${-element.scrollLeft}px, ${-element.scrollTop}px)`;
      }
    };
    if (this._config.breakoutOverflow) {
      element.classList.add("breakout-overflow");
    }
    return element;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  protected updateInternal(gameModel: GameModel): void {}

  _update(): void {
    super._update();
    if (!this.isVisible()) {
      return;
    }
    if (this._config.pointerEventsOnOverflow && this._element) {
      setTimeout(() => {
        if (this._element) {
          if (this._element.scrollHeight > this._element.clientHeight) {
            this._element.style.pointerEvents = "auto";
          } else {
            this._element.style.pointerEvents = this._config.style?.pointerEvents ?? "none";
          }
        }
      });
    }
    if (this._config.breakoutOverflow) {
      let scrolledParent = this.element.parentElement;
      while (
        (scrolledParent?.scrollLeft === 0 && scrolledParent?.scrollTop === 0) ||
        scrolledParent === document.body
      ) {
        scrolledParent = scrolledParent.parentElement;
      }
      if (scrolledParent) {
        this.element.style.transform = `translate(${-scrolledParent.scrollLeft}px, ${-scrolledParent.scrollTop}px)`;
      }
    }
  }
}
