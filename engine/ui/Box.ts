import type { GameModel } from "@/game/GameModel";
import type { Position, Rectangle } from "./Rectangle";
import { UIElement, UIElementConfig } from "./UIElement";

export type BoxConfig = UIElementConfig & {
  onClick?: () => boolean | void;
  onMouseDown?: () => boolean | void;
  onMouseUp?: () => boolean | void;
  onBlur?: () => void;
  onFocus?: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  style?: Partial<CSSStyleDeclaration>;
  breakoutOverflow?: boolean;
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

  constructor(bounds: Rectangle | Position, _config: Partial<T> = {}) {
    super(bounds, _config, defaultStyle);
  }

  protected onClickInternal(): void | boolean {
    return this._config.onClick?.();
  }

  protected onMouseDownInternal(): void | boolean {
    return this._config.onMouseDown?.();
  }

  protected onBlurInternal(): void {
    if (this._config.onBlur) {
      this._config.onBlur();
    }
  }

  protected onMouseUpInternal(): void | boolean {
    return this._config.onMouseUp?.();
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
