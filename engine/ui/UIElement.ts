import type { Position, Rectangle } from "./Rectangle";
import { isRectangle } from "./Rectangle";
import { nanoid } from "nanoid";
import { getViewportScale, getVirtualViewport, positionToCanvasSpace, scalePxStyleValue } from "../ui/utils";
import lodash from "lodash";
import { UIService } from "./UIService";
import { InputEventType } from "yage/inputs/InputManager";
import { isSyntheticMouseEvent, markTouchInteraction } from "yage/inputs/TouchMouseGuard";

const { debounce } = lodash;

const PLAYER_FOCUS_COLORS = ["#3498db", "#e74c3c", "#2ecc71", "#f39c12"];

const applyPlayerFocusStyle = (
  style: Partial<CSSStyleDeclaration>,
  focusIndices: number[]
): Partial<CSSStyleDeclaration> => {
  if (focusIndices.length === 0) {
    return {
      ...style,
      outlineColor: style.outlineColor ?? "",
      boxShadow: style.boxShadow ?? "",
    };
  }

  const focusColors = [...new Set(focusIndices)]
    .filter((index) => index >= 0)
    .map((index) => PLAYER_FOCUS_COLORS[index % PLAYER_FOCUS_COLORS.length]);

  const baseShadow = style.boxShadow ? [style.boxShadow] : [];
  const ringShadows = focusColors.map((color, index) => `0 0 0 ${2 + index * 3}px ${color}`);

  return {
    ...style,
    outlineColor: focusColors[0] ?? style.outlineColor ?? "",
    boxShadow: [...baseShadow, ...ringShadows].join(", "),
  };
};

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
  layoutRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  layoutScale?: number;
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
  interactionMountEpoch = 0;

  focusedIndices: number[] = [];
  protected lastPointerType: string | null = null;

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
      this.uiService.debouncedFocusCheck();
      return;
    }
    if (key === "captureFocus") {
      const previousCaptureFocus = this._config.captureFocus;

      this._config.captureFocus = value;
      if (this._element) {
        if (previousCaptureFocus !== undefined && previousCaptureFocus > -1) {
          this._element.classList.remove("captureFocus" + previousCaptureFocus);
        }
        if (value !== undefined && value > -1) {
          this._element.classList.add("captureFocus" + value);
          this.uiService.clearFocusedElementByPlayerIndex(value);
          this.update();
        }
      }
      this.uiService.debouncedFocusCheck();
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
      this.uiService.debouncedFocusCheck();
      return;
    }
    if (key === "layoutRect") {
      (this._config as any).layoutRect = value;
      this.update();
      return;
    }
    if (key === "layoutScale") {
      (this._config as any).layoutScale = value;
      this.update();
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
      this.interactionMountEpoch = this.uiService.registerElementMount();
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
  getChildren() {
    return this._config.children;
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
    const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0, this);
    if (playerIndex === -1) {
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
    const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0, this);
    if (playerIndex === -1) {
      return;
    }
    return this.onMouseLeaveInternal(playerIndex);
  }

  protected recordPointerInteraction(pointerType: string | null | undefined, timestamp?: number): void {
    this.lastPointerType = pointerType ?? null;
    if (pointerType === "touch") {
      markTouchInteraction(timestamp);
    }
  }

  protected getClickInputType(): InputEventType {
    if (this.lastPointerType === "touch" || isSyntheticMouseEvent()) {
      return InputEventType.TOUCH;
    }
    return InputEventType.MOUSE;
  }

  protected syncFocusForInputType(inputType: InputEventType, playerIndex: number): void {
    if (!this._config.focusable) {
      return;
    }
    if (inputType === InputEventType.MOUSE) {
      return;
    }
    this.uiService.setFocusedElementByPlayerIndex(playerIndex, this);
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
    const focusedIndices = this.uiService.elementFocusIndices(this);
    focusedIndices.forEach((playerIndex) => {
      this.uiService.clearFocusedElementByPlayerIndex(playerIndex);
    });
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
    element.onpointerdown = (e) => {
      this.recordPointerInteraction(e.pointerType, Date.now());
    };
    element.onclick = (e) => {
      const inputType = this.getClickInputType();
      if (inputType === InputEventType.TOUCH && !this.uiService.canDispatchTouchClick(this)) {
        e.stopPropagation();
        return;
      }
      const playerIndex = this.uiService.getPlayerEventIndex(inputType, 0, this);
      if (playerIndex === -1) {
        e.stopPropagation();
        return;
      }
      if (inputType === InputEventType.MOUSE) {
        this.onMouseEnter(e, true);
      }
      this.syncFocusForInputType(inputType, playerIndex);
      const res = this.onClickInternal(playerIndex);
      if (res === false) {
        e.stopPropagation();
      }
    };
    element.onmousedown = (e) => {
      if (isSyntheticMouseEvent()) {
        e.stopPropagation();
        return;
      }
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0, this);
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
      if (isSyntheticMouseEvent()) {
        e.stopPropagation();
        return;
      }
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0, this);
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
      if (isSyntheticMouseEvent()) {
        return;
      }
      this.onMouseEnter(e);
    };
    element.onmouseleave = () => {
      if (isSyntheticMouseEvent()) {
        return;
      }
      const playerIndex = this.uiService.getPlayerEventIndex(InputEventType.MOUSE, 0, this);
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

  requestingAnimationFrame = false;
  update = () => {
    if (this.requestingAnimationFrame || this.destroyed) {
      return;
    }
    this.requestingAnimationFrame = true;
    requestAnimationFrame(() => {
      this.requestingAnimationFrame = false;
      this._update();
    });
  };

  // debounce(
  //   () => {
  //     if (this.destroyed) {
  //       return;
  //     }
  //     this._update();
  //   },
  //   0,
  //   { leading: false }
  // );

  updateVisibility() {
    if (!this.isVisible()) {
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
      this._element!.focus();
      this._element!.classList.add("focused");
      setTimeout(() => {
        const focusIndex = this.uiService.elementFocusIndices(this);
        for (const index of newFocusedIndices) {
          if (focusIndex.includes(index)) {
            this.onFocus(index);
          }
        }
      }, 0);
    }
    if (removedFocusedIndices.length) {
      if (focusIndices.length === 0) {
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

    const styles =
      focusIndices.length > 0
        ? applyPlayerFocusStyle(
            {
              ...this._config.style,
              ...this._config.focusStyle,
            },
            focusIndices
          )
        : {
            ...Object.keys(this._config.focusStyle ?? {}).reduce((acc, key) => {
              acc[key as keyof CSSStyleDeclaration] = "";
              return acc;
            }, {} as Partial<CSSStyleDeclaration>),
            ...this._config.style,
            outlineColor: this._config.style.outlineColor ?? "",
            boxShadow: this._config.style.boxShadow ?? "",
          };
    const [elementScale] = this.getScales();
    const styleScale = getViewportScale() * elementScale;
    const layoutRect = this._config.layoutRect;
    const layoutScale = this._config.layoutScale ?? 1;

    if (layoutRect) {
      const viewportScale = getViewportScale();
      const vp = getVirtualViewport();
      const aspectRatio = vp.width / vp.height;
      let viewportWidth = window.innerWidth;
      let viewportHeight = window.innerWidth / aspectRatio;
      if (viewportHeight > window.innerHeight) {
        viewportHeight = window.innerHeight;
        viewportWidth = window.innerHeight * aspectRatio;
      }

      const parentHasLayoutRect = !!(this.parent && (this.parent.config as any)?.layoutRect);
      const viewportOffsetX = parentHasLayoutRect ? 0 : Math.floor((window.innerWidth - viewportWidth) / 2);
      const viewportOffsetY = parentHasLayoutRect ? 0 : Math.floor((window.innerHeight - viewportHeight) / 2);

      const x = Math.floor(layoutRect.x * viewportScale);
      const y = Math.floor(layoutRect.y * viewportScale);
      const width = Math.floor(layoutRect.width * viewportScale);
      const height = Math.floor(layoutRect.height * viewportScale);

      element.style.left = `${x + viewportOffsetX}px`;
      element.style.top = `${y + viewportOffsetY}px`;
      element.style.width = width > 1 ? `${width}px` : "auto";
      element.style.height = height > 1 ? `${height}px` : "auto";

      if (layoutScale !== 1) {
        element.style.transform = `scale(${layoutScale})`;
        element.style.transformOrigin = "top left";
      } else if (element.style.transform.startsWith("scale(")) {
        element.style.transform = "";
        element.style.transformOrigin = "";
      }

      // Layout-managed text boxes should center their own content unless the
      // screen explicitly opts into another layout mode.
      if (
        element.tagName !== "BUTTON" &&
        styles.textAlign === "center" &&
        !styles.display
      ) {
        element.style.display = "flex";
        element.style.alignItems = "center";
        element.style.justifyContent = "center";
      }
    } else {
      const [x, y, width, height] = positionToCanvasSpace(
        this.bounds,
        this._parent?._element ?? document.body,
        element,
        ...this.getScales()
      );
      if (styles.position === "absolute") {
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
      }
      element.style.width = width > 1 ? `${width}px` : "auto";
      element.style.height = height > 1 ? `${height}px` : "auto";
    }

    for (const [key, value] of Object.entries(styles)) {
      // @ts-ignore
      element.style[key] =
        typeof value === "string" && value.includes("px") ? scalePxStyleValue(value, styleScale) : value;
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
