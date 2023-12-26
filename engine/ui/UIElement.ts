import type { GameModel } from "@/game/GameModel";
import { Position, Rectangle, isRectangle } from "./Rectangle";
import { nanoid } from "nanoid";
import { positionToCanvasSpace } from "./utils";

export type UIElementConfig = {
  style: Partial<CSSStyleDeclaration>;
  children?: UIElement[];
};

export abstract class UIElement<T extends UIElementConfig = any> {
  bounds: Position;
  active = false;
  visible = true;
  id: string;

  protected _styleOverrides: Partial<CSSStyleDeclaration> | undefined;
  protected _hasChanged = true;
  protected _config: T;
  _element: HTMLElement | undefined;
  _parent: UIElement | undefined;

  get config(): T {
    return new Proxy(this._config, {
      set: (target: any, key, value) => {
        target[key] = value;
        this._hasChanged = true;
        return true;
      },
    });
  }

  get style(): Partial<CSSStyleDeclaration> {
    return new Proxy(this._config.style, {
      set: (target: any, key, value) => {
        target[key] = value;
        this._hasChanged = true;
        return true;
      },
    });
  }

  set style(value: Partial<CSSStyleDeclaration>) {
    this._config.style = value;
    this._hasChanged = true;
  }

  _setParent(parent: UIElement) {
    this._parent = parent;
    this._hasChanged = true;
  }

  addChild(child: UIElement) {
    if (!this._config.children) {
      this._config.children = [];
    }
    this._config.children.push(child);
    child._setParent(this);
  }

  updateBounds(bounds: Rectangle | Position) {
    if (isRectangle(bounds)) {
      this.bounds = bounds.toPosition();
    } else {
      this.bounds = bounds;
    }
    this._hasChanged = true;
  }

  constructor(bounds: Rectangle | Position, _config: Partial<T> = {}, defaultStyle: Partial<CSSStyleDeclaration> = {}) {
    if (!_config.style) {
      _config.style = {};
    }
    this._config = {
      ...(_config as T),
      style: {
        ...defaultStyle,
        ..._config.style,
      },
    };
    if (isRectangle(bounds)) {
      this.bounds = bounds.toPosition();
    } else {
      this.bounds = bounds;
    }
    this.id = nanoid();

    if (this._config.children) {
      for (const child of this._config.children) {
        child._setParent(this);
      }
    }
  }

  onClick() {
    console.log(`${this.bounds.x} / ${this.bounds.y}`);
    return this.onClickInternal();
  }

  onBlur() {
    return this.onBlurInternal();
  }

  onMouseDown() {
    return this.onMouseDownInternal();
  }

  onMouseUp() {
    return this.onMouseUpInternal();
  }

  protected abstract onClickInternal(): void | boolean;
  protected abstract onMouseDownInternal(): void | boolean;
  protected abstract onMouseUpInternal(): void | boolean;
  protected abstract onBlurInternal(): void;
  protected abstract onFocusInternal(): void;
  protected abstract updateInternal(gameModel: GameModel): void;
  protected abstract drawInternal(ctx: CanvasRenderingContext2D, ui: HTMLDivElement): void;
  protected abstract onMouseEnterInternal(): void;
  protected abstract onMouseLeaveInternal(): void;

  update(gameModel: GameModel) {
    this.updateInternal(gameModel);
  }

  onDestroy() {
    if (this._element) {
      this._element.remove();
    }
  }

  reset() {
    this._hasChanged = true;
  }

  createElement(): HTMLElement {
    const element = document.createElement("div");
    element.id = this.id;
    return element;
  }

  addEvents(element: HTMLElement) {
    element.onclick = () => {
      this.onClickInternal();
    };
    element.onmousedown = () => {
      this.onMouseDownInternal();
    };
    element.onmouseup = () => {
      this.onMouseUpInternal();
    };
    element.onblur = () => {
      this.onBlurInternal();
    };
    element.onfocus = () => {
      this.onFocusInternal();
    };
    element.onmouseenter = () => {
      this.onMouseEnterInternal();
    };
    element.onmouseleave = () => {
      this.onMouseLeaveInternal();
    };
  }

  draw(canvas: HTMLCanvasElement, ui: HTMLDivElement) {
    if (this._styleOverrides) {
      this._hasChanged = true;
    }
    this.config.children?.forEach((x) => {
      if (x.visible !== this.visible) {
        x.visible = this.visible;
        x._setParent(this);
      }
    });
    if (!this.visible && this._element) {
      this._element.style.display = "none";
      return;
    } else if (this._element) {
      this._element.style.display = "block";
    }
    if (!this._hasChanged && this._element) {
      return;
    }

    if (this._hasChanged && this._element) {
      this.config.children?.forEach((x) => x._setParent(this));

      const [x, y, width, height] = positionToCanvasSpace(this.bounds, this._parent?._element ?? document.body);
      this._element.style.left = `${x}px`;
      this._element.style.top = `${y}px`;
      this._element.style.width = width > 1 ? `${width}px` : "auto";
      this._element.style.height = height > 1 ? `${height}px` : "auto";

      const styles = {
        ...this._config.style,
        ...this._styleOverrides,
      };

      for (const [key, value] of Object.entries(styles)) {
        // @ts-ignore
        this._element.style[key] = value;
      }
      this._hasChanged = false;
    }
    this.drawInternal(null as any, ui);
  }
}
