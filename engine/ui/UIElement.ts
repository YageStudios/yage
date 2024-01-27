import type { GameModel } from "@/game/GameModel";
import { Position, Rectangle, isRectangle } from "./Rectangle";
import { nanoid } from "nanoid";
import { positionToCanvasSpace } from "../ui/utils";

export type UIElementConfig = {
  style: Partial<CSSStyleDeclaration>;
  children?: UIElement[];
  visible?: boolean;
};

export abstract class UIElement<T extends UIElementConfig = any> {
  bounds: Position;
  active = false;
  _visible = true;
  _id: string;

  _styleOverrides: Partial<CSSStyleDeclaration> | undefined;
  protected _config: T;
  _element: HTMLElement | undefined;
  _parent: UIElement | undefined;
  _zIndex = 0;

  get id() {
    return this._id;
  }

  set id(value: string) {
    this._id = value;
    this.element.id = value;
    this.update();
  }

  get visible() {
    return this._visible;
  }

  set visible(value: boolean) {
    this._visible = value;
    this.update();
  }

  get config(): T {
    return new Proxy(this._config, {
      set: (target: any, key, value) => {
        target[key] = value;
        this.update();
        return true;
      },
    });
  }

  get style(): Partial<CSSStyleDeclaration> {
    return new Proxy(this._config.style, {
      set: (target: any, key, value) => {
        target[key] = value;
        this.update();
        return true;
      },
    });
  }

  set style(value: Partial<CSSStyleDeclaration>) {
    this._config.style = value;
    this.update();
  }

  get element(): ReturnType<this["createElement"]> {
    if (!this._element) {
      const element = this.createElement();
      document.getElementById("ui")?.appendChild(element);
      this._element = element;
      this.addEvents(element);
    }
    // @ts-ignore
    return this._element!;
  }

  set position(value: Position | Rectangle) {
    this.bounds = isRectangle(value) ? value.toPosition() : value;
    this.update();
  }

  get position() {
    return new Proxy(this.bounds, {
      set: (target: any, key, value) => {
        target[key] = value;
        this.update();
        return true;
      },
    });
  }

  set parent(parent: UIElement) {
    this._parent = parent;
    parent.element.appendChild(this.element);
    this.update();
    parent.update();
  }

  addChild(child: UIElement) {
    if (!this._config.children) {
      this._config.children = [];
    }
    this._config.children.push(child);
    child.parent = this;
  }

  constructor(bounds: Rectangle | Position, _config: Partial<T> = {}, defaultStyle: Partial<CSSStyleDeclaration> = {}) {
    if (!_config.style) {
      _config.style = {};
    }
    this._config = {
      visible: true,
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
    this._id = nanoid();

    if (this._config.children) {
      for (const child of this._config.children) {
        child.parent = this;
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
  protected abstract onMouseEnterInternal(): void;
  protected abstract onMouseLeaveInternal(): void;

  onDestroy() {
    if (this._element) {
      this._element.remove();
    }
  }

  reset() {}

  createElement(): HTMLElement {
    const element = document.createElement("div");
    element.id = this.id;
    return element;
  }

  addEvents(element: HTMLElement) {
    element.onclick = (e) => {
      const res = this.onClickInternal();
      if (res === false) {
        e.stopPropagation();
      }
    };
    element.onmousedown = (e) => {
      const res = this.onMouseDownInternal();
      if (res === false) {
        e.stopPropagation();
      }
    };
    element.onmouseup = (e) => {
      const res = this.onMouseUpInternal();
      if (res === false) {
        e.stopPropagation();
      }
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

  update() {
    this._zIndex = (this._parent?._zIndex ?? 0) + parseInt(this._config.style.zIndex ?? "0");
    const notVisible = !this.visible || !this._config.visible;
    const visible = !notVisible;

    const element = this.element;
    if (!visible) {
      element.style.display = "none";
      return;
    } else {
      element.style.display = "block";
    }

    const [x, y, width, height] = positionToCanvasSpace(this.bounds, this._parent?.element ?? document.body);
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
    element.style.width = width > 1 ? `${width}px` : "auto";
    element.style.height = height > 1 ? `${height}px` : "auto";
    element.style.position = "absolute";

    const styles = {
      ...this._config.style,
      ...this._styleOverrides,
    };

    for (const [key, value] of Object.entries(styles)) {
      // @ts-ignore
      element.style[key] = value;
    }
    if (this._zIndex > 0) {
      element.style.zIndex = `${this._zIndex}`;
    }
    this.config.children?.forEach((x) => {
      if (x.visible !== visible) {
        x.visible = visible;
      }
      x.update();
    });
  }
}
