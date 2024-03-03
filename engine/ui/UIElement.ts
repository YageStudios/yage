import { Position, Rectangle, isRectangle } from "./Rectangle";
import { nanoid } from "nanoid";
import { positionToCanvasSpace } from "../ui/utils";
import { debounce } from "lodash";
import { UIService } from "./UIService";
import { InputEventType } from "@/inputs/InputManager";

export type UIElementConfig = {
  style: Partial<CSSStyleDeclaration>;
  children?: UIElement[];
  visible?: boolean;
  parent?: UIElement | RootUIElement;
  focusable?: boolean;
  autoFocus?: boolean;
  captureFocus?: number;
  focusStyle?: Partial<CSSStyleDeclaration>;
  onEscape?: (playerIndex: number) => void;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
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
  focusedIndices: number[] = [];

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
      let previousCaptureFocus = this._config.captureFocus;
      this._config.captureFocus = value;
      if (this._element) {
        if (value !== undefined && value > -1) {
          this._element.classList.add("captureFocus" + value);
          this.uiService.clearFocusedElementByPlayerIndex(value);
          this.update();
        } else {
          if (previousCaptureFocus !== undefined && previousCaptureFocus > -1) {
            this._element.classList.remove("captureFocus" + previousCaptureFocus);
          }
        }
      }
      return;
    }
    if (key === "autoFocus") {
      this._config.autoFocus = value;
      if (this._element) {
        if (value) {
          this._element.classList.add("autoFocus");
        } else {
          this._element.classList.remove("autoFocus");
        }
      }
      return;
    }
    (this._config as any)[key as keyof T] = value;
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

  onEscape(playerIndex: number) {
    if (this._config.onEscape) {
      this._config.onEscape(playerIndex);
    }
  }

  onClick(playerIndex: number) {
    const focusables = this.uiService.getFocusables(playerIndex);
    if (this._element && focusables?.includes(this._element)) {
      return this.onClickInternal(playerIndex);
    }
  }

  onBlur(playerIndex: number) {
    return this.onBlurInternal(playerIndex);
  }

  onFocus(playerIndex: number) {
    return this.onFocusInternal(playerIndex);
  }

  onMouseDown(playerIndex: number) {
    return this.onMouseDownInternal(playerIndex);
  }

  onMouseUp(playerIndex: number) {
    return this.onMouseUpInternal(playerIndex);
  }

  onMouseEnter(e: MouseEvent, forced = false) {
    const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0);
    if (playerIndex === -1) {
      return;
    }
    if (!forced && this.uiService.lastMouseMove + 200 < +new Date()) {
      return;
    }

    let mouseInBounds = true;

    if (this._config.focusable) {
      const nestedFocused = this._element?.querySelector(
        `.captureFocus${playerIndex}:not(:has(.captureFocus${playerIndex})):has(.focused)`
      );
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
    if (this._config.focusable && mouseInBounds) {
      this.uiService.attemptMouseFocus(this);
    }
    return this.onMouseEnterInternal(playerIndex);
  }

  onMouseLeave() {
    const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0);
    if (playerIndex === -1) {
      return;
    }
    if (this.uiService.lastMouseMove + 200 < +new Date()) {
      return;
    }
    return this.onMouseLeaveInternal(playerIndex);
  }

  protected abstract onClickInternal(playerIndex: number): void | boolean;
  protected abstract onMouseDownInternal(playerIndex: number): void | boolean;
  protected abstract onMouseUpInternal(playerIndex: number): void | boolean;
  protected abstract onBlurInternal(playerIndex: number): void;
  protected abstract onFocusInternal(playerIndex: number): void;
  protected abstract onMouseEnterInternal(playerIndex: number): void;
  protected abstract onMouseLeaveInternal(playerIndex: number): void;

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
      if (!noUpdate) {
        const focusIndices = this.uiService.elementFocusIndices(this);
        for (const focusIndex of focusIndices) {
          this.uiService.traverseParentFocusByPlayerIndex(focusIndex);
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
    if (this._config.captureFocus !== undefined && this._config.captureFocus > -1) {
      element.classList.add("captureFocus" + this._config.captureFocus);
      this.uiService.clearFocusedElementByPlayerIndex(this._config.captureFocus);
    }
    if (this._config.autoFocus) {
      element.classList.add("autoFocus");
    }
    return element;
  }

  addEvents(element: HTMLElement) {
    element.onclick = (e) => {
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0);
      if (playerIndex === -1) {
        e.stopPropagation();
        return;
      }
      this.onMouseEnter(e, true);
      const res = this.onClickInternal(playerIndex);
      if (res === false) {
        e.stopPropagation();
      }
    };
    element.onmousedown = (e) => {
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0);
      if (playerIndex === -1) {
        e.stopPropagation();
        return;
      }
      const res = this.onMouseDownInternal(playerIndex);
      if (res === false) {
        e.stopPropagation();
      }
    };
    element.onmouseup = (e) => {
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0);
      if (playerIndex === -1) {
        e.stopPropagation();
        return;
      }
      const res = this.onMouseUpInternal(playerIndex);
      if (res === false) {
        e.stopPropagation();
      }
    };
    element.onmouseenter = (e) => {
      this.onMouseEnter(e);
    };
    element.onmouseleave = () => {
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0);
      if (playerIndex === -1) {
        return;
      }
      this.onMouseLeaveInternal(playerIndex);
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

  getScales(): [number, number, number] {
    let scale = this._config.scale ?? 1;
    let scaleX = this._config.scaleX ?? 1;
    let scaleY = this._config.scaleY ?? 1;
    let parent = this._parent;
    while (parent) {
      scale *= parent.config.scale ?? 1;
      scaleX *= parent.config.scaleX ?? 1;
      scaleY *= parent.config.scaleY ?? 1;
      // @ts-ignore
      parent = parent._parent;
    }
    return [scale, scaleX, scaleY];
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

    const focusIndices = this.uiService.elementFocusIndices(this);
    const newFocusedIndices = focusIndices.filter((x) => !this.focusedIndices.includes(x));
    const removedFocusedIndices = this.focusedIndices.filter((x) => !focusIndices.includes(x));
    this.focusedIndices = focusIndices;
    if (newFocusedIndices.length > 0) {
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
          const focusIndex = this.uiService.elementFocusIndices(this);
          for (const index of newFocusedIndices) {
            if (focusIndex.includes(index)) {
              this.onFocus(index);
            }
          }
        }, 0);
      }
    }
    if (removedFocusedIndices.length && this.cachedStyle) {
      if (focusIndices.length === 0) {
        this._config.style = this.cachedStyle;
        this.cachedStyle = undefined;
        this.focusedStyle = undefined;
        this._element!.classList.remove("focused");
      }
      for (const index of removedFocusedIndices) {
        this.onBlur(index);
      }
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

    const [x, y, width, height] = positionToCanvasSpace(
      this.bounds,
      this._parent?._element ?? document.body,
      ...this.getScales()
    );
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
