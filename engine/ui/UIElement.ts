import { Position, Rectangle, isRectangle } from "./Rectangle";
import { nanoid } from "nanoid";
import { positionToCanvasSpace } from "../ui/utils";
import { debounce } from "lodash";
import { UIService } from "./UIService";

export type UIElementConfig = {
  style: Partial<CSSStyleDeclaration>;
  children?: UIElement[];
  visible?: boolean;
  parent?: UIElement | RootUIElement;
  focusable?: boolean;
  autoFocus?: boolean;
  autoEmptyFocus?: boolean;
  captureFocus?: boolean;
  focusStyle?: Partial<CSSStyleDeclaration>;
};

export type RootUIElement = {
  isVisible: () => boolean;
  update: () => void;
  addChild: (child: UIElement) => void;
  removeChild: (child: UIElement) => void;
  _element: HTMLElement;
  _zIndex: number;
  config: {
    children?: UIElement[];
  };
};

const isRootUIElement = (x: any): x is RootUIElement => {
  return x._update === undefined;
};

export abstract class UIElement<T extends UIElementConfig = any> {
  bounds: Position;
  _visible = true;
  _id: string;

  protected _config: T;
  _element: HTMLElement | undefined;
  _parent: UIElement | RootUIElement | undefined;
  _zIndex = 0;
  _creationDate = new Date().toISOString();
  removeTheseChildren: UIElement[] = [];
  destroyed: boolean;
  uiService: UIService;

  cachedStyle: Partial<CSSStyleDeclaration> | undefined;
  focusedStyle: Partial<CSSStyleDeclaration> | undefined;

  get id() {
    return this._id;
  }

  set id(value: string) {
    delete this.uiService.mappedIds[this._id];
    this._id = value;
    this.element.id = value;
    this.uiService.mappedIds[value] = this;
    this.update();
  }

  get visible() {
    return this._visible;
  }

  set visible(value: boolean) {
    this._visible = value;
    this.updateVisibility();
  }

  protected handleConfigChange(key: string, value: any) {
    if (key === "visible") {
      this._config.visible = value;
      this.updateVisibility();
      return;
    }
    if (key === "focusable") {
      this._config.focusable = value;
      if (this._element) {
        if (value) {
          this._element.classList.add("focusable");
        } else {
          this._element.classList.remove("focusable");
        }
      }
      return;
    }
    if (key === "captureFocus") {
      this._config.captureFocus = value;
      if (this._element) {
        if (value) {
          this._element.classList.add("captureFocus");
          this.uiService.clearFocusedElement();
          this.update();
        } else {
          this._element.classList.remove("captureFocus");
        }
      }
      return;
    }
    this._config[key as keyof UIElementConfig] = value;
    this.update();
  }

  get config(): T {
    return new Proxy(this._config, {
      set: (target: any, key, value) => {
        this.handleConfigChange(key as string, value);
        return true;
      },
      get: (target: any, key) => {
        if (key === "style") {
          return this.style;
        }
        return target[key];
      },
    });
  }

  get style(): Partial<CSSStyleDeclaration> {
    return new Proxy(this._config.style, {
      set: (target: any, key, value) => {
        if (this.cachedStyle) {
          this.cachedStyle[key as any] = value;
        }
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

  set parent(parent: UIElement | RootUIElement | undefined) {
    this._parent = parent;
    if (parent) {
      parent.addChild(this);
    }
  }

  get parent() {
    return this._parent;
  }

  removeAllChildren() {
    this._config.children = [];
    this._config.children?.forEach((x) => {
      x.onDestroy(true);
    });
    this._config.children = [];
    this.update();
  }

  removeChild(child: UIElement) {
    if (this._config.children) {
      this._config.children = this._config.children.filter((x) => x !== child);
    }
    this.update();
  }

  addChild(child: UIElement) {
    if (!this._config.children) {
      this._config.children = [];
    }
    if (!this._config.children.includes(child)) {
      this._config.children.push(child);
    }
    if (child._parent !== this) {
      child.parent = this;
    }
    this.update();
  }

  constructor(bounds: Rectangle | Position, _config: Partial<T> = {}, defaultStyle: Partial<CSSStyleDeclaration> = {}) {
    this.uiService = UIService.getInstance();
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
    this.uiService.mappedIds[this._id] = this;

    if (this._config.children) {
      for (const child of this._config.children) {
        child.parent = this;
      }
    } else if (this._config.parent) {
      this.parent = this._config.parent;
    }
  }

  onClick() {
    return this.onClickInternal();
  }

  onBlur() {
    return this.onBlurInternal();
  }

  onFocus() {
    return this.onFocusInternal();
  }

  onMouseDown() {
    return this.onMouseDownInternal();
  }

  onMouseUp() {
    return this.onMouseUpInternal();
  }

  onMouseEnter(e: MouseEvent) {
    if (this.uiService.lastMouseMove + 200 < +new Date()) {
      return;
    }

    let mouseInBounds = true;

    if (this._config.focusable) {
      const nestedFocused = this._element?.querySelector(".captureFocus:not(:has(.captureFocus)):has(.focused)");
      if (nestedFocused) {
        mouseInBounds = false;
      } else {
        const rect = this._element?.getBoundingClientRect();
        if (
          rect &&
          (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)
        ) {
          mouseInBounds = false;
        }
      }
      if (!mouseInBounds) {
        return;
      }
    }
    if (this._config.focusable && mouseInBounds && this.uiService.focusedElement !== this) {
      this.uiService.focusedElement = this;
    }
    return this.onMouseEnterInternal();
  }

  onMouseLeave() {
    if (this.uiService.lastMouseMove + 200 < +new Date()) {
      return;
    }
    return this.onMouseLeaveInternal();
  }

  protected abstract onClickInternal(): void | boolean;
  protected abstract onMouseDownInternal(): void | boolean;
  protected abstract onMouseUpInternal(): void | boolean;
  protected abstract onBlurInternal(): void;
  protected abstract onFocusInternal(): void;
  protected abstract onMouseEnterInternal(): void;
  protected abstract onMouseLeaveInternal(): void;

  onDestroy(noUpdate?: boolean) {
    this.destroyed = true;
    delete this.uiService.mappedIds[this._id];
    this.removeElement(noUpdate);
    this?.parent?.removeChild(this);

    this._config.children?.forEach((x) => {
      x.onDestroy(true);
    });
  }

  reset() {}

  private removeElement(noUpdate?: boolean) {
    if (this._element) {
      this._element?.parentElement?.removeChild(this._element);
      this._element?.remove();
      this._element = undefined;
      if (this._config.autoEmptyFocus) {
        this.uiService.autoEmptyFocusElements = this.uiService.autoEmptyFocusElements.filter((x) => x !== this);
      }
      if (!noUpdate) {
        if (this.uiService.focusedElement === this) {
          this.uiService.traverseParentFocus();
        }
        if (this.parent && !isRootUIElement(this.parent)) {
          this.parent?.update();
        }
      }
    }
  }

  createElement(): HTMLElement {
    const element = document.createElement("div");
    element.id = this.id;
    if (this._config.focusable) {
      element.classList.add("focusable");
    }
    if (this._config.captureFocus) {
      element.classList.add("captureFocus");
      this.uiService.clearFocusedElement();
    }
    if (this._config.autoEmptyFocus) {
      if (!this.uiService.autoEmptyFocusElements.includes(this)) {
        this.uiService.autoEmptyFocusElements.push(this);
      }
    }
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
    element.onmouseenter = (e) => {
      this.onMouseEnter(e);
    };
    element.onmouseleave = () => {
      this.onMouseLeaveInternal();
    };
  }

  isVisible = (): boolean => {
    const notVisible = this.destroyed || !this._visible || this._config.visible === false || !this._parent?.isVisible();
    const visible = !notVisible;

    return visible;
  };

  update = debounce(
    () => {
      if (this.destroyed) {
        return;
      }
      this._update();
    },
    0,
    { leading: false }
  );

  updateVisibility() {
    if (!this.isVisible()) {
      this.focusedStyle = undefined;
      if (this.cachedStyle) {
        this._config.style = this.cachedStyle;
        this.cachedStyle = undefined;
      }
      if (this._element) {
        this.removeElement();
        // this._element.style.display = "none";
      }
      this._config.children?.forEach((x) => {
        x.updateVisibility();
      });
      return;
    }
    if (!this._element) {
      this.update();
    }
  }

  _update() {
    if (!this.isVisible()) {
      this.updateVisibility();
      return;
    }

    this._zIndex = (this._parent?._zIndex ?? 0) + parseInt(this._config.style.zIndex ?? "0");

    const element = this.element;
    if (!element) {
      return;
    }
    element.style.display = "block";

    if (this.uiService._focusedElement === this) {
      if (!this.focusedStyle) {
        this.focusedStyle = {
          ...this._config.style,
          ...this._config.focusStyle,
        };
        const reset = Object.entries(this.focusedStyle).reduce((acc, [key, value]) => {
          acc[key as any] = "";
          return acc;
        }, {} as any);

        // @ts-ignore
        this.cachedStyle = {
          ...reset,
          ...this._config.style,
        };

        this._config.style = this.focusedStyle;
        this._element!.focus();
        this._element!.classList.add("focused");
        // move the focus out of the render loop to allow the blur event to fire first
        setTimeout(() => {
          if (this.uiService._focusedElement === this) {
            this.onFocus();
          }
        }, 0);
      }
    } else if (this.uiService._focusedElement !== this && this.cachedStyle) {
      this._config.style = this.cachedStyle;
      this.cachedStyle = undefined;
      this.focusedStyle = undefined;
      this._element!.classList.remove("focused");
      this.onBlur();
    } else if (this._config.focusable && this._config.autoFocus && this.uiService._focusedElement === undefined) {
      this.uiService.focusedElement = this;
    }

    const parentElement = this.parent?._element;
    if (!element.parentElement || (parentElement && element.parentElement !== parentElement)) {
      parentElement?.appendChild(element);
    }
    if (parentElement) {
      element.style.order = `${this.parent!.config.children?.indexOf(this) ?? 0}`;
    }

    const styles = {
      ...this._config.style,
    };

    const [x, y, width, height] = positionToCanvasSpace(this.bounds, this._parent?._element ?? document.body);
    if (styles.position === "absolute") {
      element.style.left = `${x}px`;
      element.style.top = `${y}px`;
    }
    element.style.width = width > 1 ? `${width}px` : "auto";
    element.style.height = height > 1 ? `${height}px` : "auto";

    for (const [key, value] of Object.entries(styles)) {
      // @ts-ignore
      element.style[key] = value;
    }
    if (this._zIndex > 0) {
      element.style.zIndex = `${this._zIndex}`;
    }
    this.config.children?.forEach((x, index) => {
      x.update();
      if (x._element) {
        x._element.style.order = `${index}`;
      }
    });
  }
}
