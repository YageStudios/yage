import type { RootUIElement, UIElement } from "./UIElement";
import type { Vector2d } from "../utils/vector";
import { getGlobalSingleton, setGlobalSingleton } from "yage/global";
import type { InputManager } from "yage/inputs/InputManager";
import { InputEventType } from "yage/inputs/InputManager";
import type { PlaySoundOptions } from "yage/utils/playSound";
import { playSound } from "yage/utils/playSound";
import { flags } from "yage/console/flags";
import { debounce } from "lodash";

const DEBUG_FOCUS = false;
export class UIService {
  elements: UIElement[] = [];
  UICanvas: HTMLCanvasElement;
  clickedElement: UIElement | null;
  clickedElements: UIElement[] | null;
  mouseOffset: Vector2d | null;
  interactionDiv: HTMLElement;
  uiDiv: HTMLDivElement;

  mappedIds: { [key: string]: UIElement } = {};
  uiElements: { [key: string]: UIElement } = {};

  keyPressListeners: ((key: string) => void)[] = [];

  lastMouseMove: number;
  debugCanvas: any;
  unsub: (() => void) | undefined;

  playerInputs: [InputEventType, number][] = [[InputEventType.ANY, 0]];

  ui: { [key: string]: UIElement } = new Proxy(this.uiElements, {
    get: (target, prop) => {
      return target[prop as any];
    },
    set: (target, prop, value) => {
      if (target[prop as any]) {
        UIService.getInstance().removeFromUI(target[prop as any]);
      }
      target[prop as any] = value;
      UIService.getInstance().addToUI(value);
      return true;
    },
    deleteProperty: (target, prop) => {
      if (!target[prop as any]) {
        return true;
      }
      UIService.getInstance().removeFromUI(target[prop as any]);
      delete target[prop as any];
      return true;
    },
  });

  getPlayerEventIndex(eventType: InputEventType, inputIndex: number, element?: UIElement): number {
    if (this.playerInputs[0][0] === InputEventType.ANY) {
      return 0;
    }

    if (element && eventType === InputEventType.TOUCH) {
      const touchUsers = this.playerInputs.filter(([type]) => type === InputEventType.TOUCH);
      for (let i = 0; i < touchUsers.length; i++) {
        const focusables = this.getFocusables(i);
        if (focusables.includes(element._element!)) {
          return i;
        }
      }
    }

    for (let i = 0; i < this.playerInputs.length; i++) {
      if (eventType === InputEventType.MOUSE && this.playerInputs[i][0] === InputEventType.KEYBOARD) {
        return i;
      }
      if (this.playerInputs[i][0] === eventType && this.playerInputs[i][1] === inputIndex) {
        return i;
      }
    }

    return -1;
  }

  _keyCaptureListener = (
    inputManager: InputManager,
    key: string,
    pressed: boolean,
    eventType: InputEventType,
    inputIndex: number,
    e?: Event
  ) => {
    const playerEventIndex = this.getPlayerEventIndex(eventType, inputIndex);
    if (!pressed || [InputEventType.TOUCH, InputEventType.MOUSE].includes(eventType)) {
      return;
    }
    let left = key === "left" || key === "a";
    let right = key === "right" || key === "d";
    let up = key === "up" || key === "w";
    let down = key === "down" || key === "s";
    if (eventType === InputEventType.GAMEPAD) {
      left =
        key === "left" ||
        (inputManager.keyPressed("a", eventType, inputIndex) &&
          !inputManager.keyPressed("w", eventType, inputIndex) &&
          !inputManager.keyPressed("s", eventType, inputIndex));
      right =
        key === "right" ||
        (inputManager.keyPressed("d", eventType, inputIndex) &&
          !inputManager.keyPressed("w", eventType, inputIndex) &&
          !inputManager.keyPressed("s", eventType, inputIndex));
      up =
        key === "up" ||
        (inputManager.keyPressed("w", eventType, inputIndex) &&
          !inputManager.keyPressed("a", eventType, inputIndex) &&
          !inputManager.keyPressed("d", eventType, inputIndex));
      down =
        key === "down" ||
        (inputManager.keyPressed("s", eventType, inputIndex) &&
          !inputManager.keyPressed("a", eventType, inputIndex) &&
          !inputManager.keyPressed("d", eventType, inputIndex));
    }

    if (left || right || up || down) {
      const direction = { x: 0, y: 0 };

      if (up) {
        direction.y -= 1;
      }
      if (down) {
        direction.y += 1;
      }
      if (left) {
        direction.x -= 1;
      }
      if (right) {
        direction.x += 1;
      }

      if (flags.DEBUG) {
        if (!this.debugCanvas) {
          this.createDebugCanvas();
        }
        this.debugCtx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
      } else if (this.debugCanvas) {
        this.debugCanvas.remove();
        this.debugCanvas = undefined;
      }

      if (this._focusedElementByPlayerIndex[playerEventIndex]?._element) {
        this._focusedElementPositionByPlayerIndex[playerEventIndex] = this.getElementCenter(
          this._focusedElementByPlayerIndex[playerEventIndex]!._element
        );
      }
      const focusedElement = this.findClosestFocusableElement(
        this._focusedElementPositionByPlayerIndex[playerEventIndex],
        direction as { x: 0 | 1 | -1; y: 0 | 1 | -1 },
        playerEventIndex
      );
      if (focusedElement) {
        this.setFocusedElementByPlayerIndex(playerEventIndex, focusedElement);
      }
      e?.preventDefault();
      e?.stopPropagation();
    }

    // remap q to escape since the b button is mapped to q
    if (eventType === InputEventType.GAMEPAD && key === "q") {
      key = "escape";
    }

    switch (key.toLocaleLowerCase()) {
      case "space":
        if (this._focusedElementByPlayerIndex[playerEventIndex]) {
          this._focusedElementByPlayerIndex[playerEventIndex]!.onClick(playerEventIndex);
          e?.preventDefault();
          e?.stopImmediatePropagation();
        }

        break;
      case "escape":
        if (this._focusedElementByPlayerIndex[playerEventIndex]) {
          this._focusedElementByPlayerIndex[playerEventIndex]!.onEscape(playerEventIndex);
        }
        break;
    }
  };
  debugCtx: CanvasRenderingContext2D;

  enableKeyCapture(inputManager: InputManager) {
    this.unsub = inputManager.addKeyListener((...args) => this._keyCaptureListener(inputManager, ...args));
  }

  disableKeyCapture() {
    if (this.unsub) {
      this.unsub();
      this.unsub = undefined;
    }
  }

  constructor(uiCanvas: HTMLCanvasElement) {
    this.UICanvas = uiCanvas;
    this.interactionDiv = document.getElementById("interaction") as HTMLElement;
    this.uiDiv = document.getElementById("ui") as HTMLDivElement;
    this.registerEvents();

    this.root = {
      isVisible: () => true,
      update: () => {
        this.elements.forEach((element) => {
          if (!element.destroyed) {
            element._update();
          }
        });
      },
      addChild: (child: UIElement) => {
        if (!this.elements.includes(child)) {
          this.elements.push(child);
        }
        child._update();
      },
      removeChild: (child: UIElement) => {
        this.elements = this.elements.filter((x) => x !== child);
      },
      _element: this.uiDiv!,
      _zIndex: 0,
      config: {
        children: [],
      },
    };
  }

  static configureUi(uiCanvas?: HTMLCanvasElement) {
    if (!getGlobalSingleton("UIService")) {
      setGlobalSingleton("UIService", new UIService(uiCanvas!));
    }
  }

  static getInstance(): UIService {
    const instance = getGlobalSingleton("UIService");
    if (!instance) {
      UIService.configureUi();
    }
    return instance ?? getGlobalSingleton("UIService")!;
  }

  registerEvents() {
    window.addEventListener("resize", () => {
      this.elements.forEach((element) => {
        if (!element.destroyed) {
          element._update();
        }
      });
      setTimeout(() => {
        this.elements.forEach((element) => {
          if (!element.destroyed) {
            element._update();
          }
        });
      }, 100);
    });

    window.addEventListener("mousemove", () => {
      this.lastMouseMove = +new Date();
    });
  }

  addKeyPressListener(listener: (key: string) => void) {
    this.keyPressListeners.push(listener);
    return () => {
      this.keyPressListeners = this.keyPressListeners.filter((l) => l !== listener);
    };
  }

  attemptMouseFocus(element: UIElement) {
    const playerEventIndex = this.getPlayerEventIndex(InputEventType.MOUSE, 0);
    if (playerEventIndex === -1) {
      return;
    }
    const focusables = this.getFocusables(playerEventIndex);
    if (!focusables.includes(element._element!)) {
      return;
    }
    const focuedElement = this._focusedElementByPlayerIndex[playerEventIndex];
    if (focuedElement !== element) {
      this.setFocusedElementByPlayerIndex(playerEventIndex, element);
    }
  }

  attemptAutoFocus(playerIndex: number) {
    if (!this._focusedElementByPlayerIndex[playerIndex]) {
      const availableAutoFocus = this.getFocusables(playerIndex, true);

      if (!availableAutoFocus.length) {
        return;
      }
      let closest = availableAutoFocus[0];
      if (this._focusedElementPositionByPlayerIndex[playerIndex]) {
        let closestDistance = Infinity;
        availableAutoFocus.forEach((element) => {
          const center = this.getElementCenter(element)!;
          // favor the left
          center.x += 1;
          const distance =
            (center.x - (this._focusedElementPositionByPlayerIndex[playerIndex]?.x ?? window.innerWidth / 2)) ** 2 +
            (center.y - (this._focusedElementPositionByPlayerIndex[playerIndex]?.y ?? window.innerHeight / 2)) ** 2;
          if (distance < closestDistance) {
            closest = element;
            closestDistance = distance;
          }
        });
      }
      this._focusedElementByPlayerIndex[playerIndex] = this.mappedIds[closest.id];
      this.mappedIds[closest.id]._update();
    }
  }

  elementFocusIndices(element: UIElement) {
    const indices: number[] = [];
    for (let i = 0; i < this._focusedElementByPlayerIndex.length; i++) {
      if (this._focusedElementByPlayerIndex[i] === element) {
        indices.push(i);
      }
    }
    return indices;
  }

  traverseParentFocusByPlayerIndex(playerIndex: number) {
    let nestedParent = this._focusedElementByPlayerIndex[playerIndex]?._parent;
    while (nestedParent) {
      if (nestedParent.config.focusable) {
        // @ts-ignore
        this.setFocusedElementByPlayerIndex(playerIndex, nestedParent);
        return;
      }
      // @ts-ignore
      nestedParent = nestedParent._parent;
    }
    this.setFocusedElementByPlayerIndex(playerIndex, undefined);
  }

  _focusedElementByPlayerIndex: (UIElement | undefined)[] = [];
  _focusedElementPositionByPlayerIndex: { [key: number]: Vector2d | undefined } = {};

  setFocusedElementByPlayerIndex(playerIndex: number, element: UIElement | undefined) {
    const previous = this._focusedElementByPlayerIndex[playerIndex];
    this._focusedElementByPlayerIndex[playerIndex] = element;
    if (element) {
      this._focusedElementPositionByPlayerIndex[playerIndex] = this.getElementCenter(element._element);
      element._update();
    }
    if (!element) {
      setTimeout(() => {
        this.debouncedFocusCheck();
      }, 0);
    }

    if (previous && !previous?.destroyed) {
      previous._update();
    }
  }

  clearFocusedElementByPlayerIndex(playerIndex: number) {
    const previous = this._focusedElementByPlayerIndex[playerIndex];
    this._focusedElementByPlayerIndex[playerIndex] = undefined;
    this._focusedElementPositionByPlayerIndex[playerIndex] = undefined;
    setTimeout(() => {
      if (previous && !previous?.destroyed) {
        previous._update();
      }
      this.debouncedFocusCheck();
    }, 0);
  }

  createDebugCanvas() {
    if (!this.debugCanvas) {
      this.debugCanvas = document.createElement("canvas");
      this.debugCanvas.width = window.innerWidth;
      this.debugCanvas.height = window.innerHeight;
      this.debugCanvas.style.position = "absolute";
      this.debugCanvas.style.top = "0";
      this.debugCanvas.style.left = "0";
      this.debugCanvas.style.pointerEvents = "none";
      this.debugCanvas.style.zIndex = "100000";
      document.body.appendChild(this.debugCanvas);
    }
    this.debugCtx = this.debugCanvas.getContext("2d")! as CanvasRenderingContext2D;
    this.debugCtx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
  }

  getElementCenter = (element: Element | undefined) => {
    if (!element || !element.parentElement) {
      return undefined;
    }
    const getScrollContainer = (element: Element | undefined) => {
      if (!element) {
        return;
      }
      let possibleScrollContainer = element;

      while (possibleScrollContainer.scrollHeight > possibleScrollContainer.clientHeight) {
        possibleScrollContainer = possibleScrollContainer.parentElement!;
        if (!possibleScrollContainer) {
          return;
        }

        if (possibleScrollContainer.scrollHeight > possibleScrollContainer.clientHeight) {
          return possibleScrollContainer;
        }
      }
    };

    const focusableScrollContainer = getScrollContainer(element);
    const bounds = element.getBoundingClientRect();
    const center = {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };

    if (focusableScrollContainer) {
      const focusableScrollContainerBounds = focusableScrollContainer.getBoundingClientRect();
      // center.y += focusableScrollContainer.scrollTop;
      const distanceFromFocusableTop =
        bounds.top -
        focusableScrollContainerBounds.top -
        (focusableScrollContainer.scrollTop / focusableScrollContainer.scrollHeight) *
          focusableScrollContainer.clientHeight;
      const distanceRatio = distanceFromFocusableTop / focusableScrollContainer.scrollHeight;

      center.y = center.y - distanceFromFocusableTop + focusableScrollContainer.clientHeight * distanceRatio;
    }

    if (flags.DEBUG) {
      if (!this.debugCanvas) {
        this.createDebugCanvas();
      }
      const ctx = this.debugCtx;
      // draw a circle at the center on the debug canvas
      ctx.fillStyle = "red";
      ctx.strokeStyle = "green";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, 15, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    } else if (this.debugCanvas) {
      this.debugCanvas.remove();
      this.debugCanvas = undefined;
    }

    return center;
  };

  getFocusables = (playerIndex: number, autoFocus = false) => {
    let antiPlayerIndex =
      this.playerInputs.length > 1
        ? // eslint-disable-next-line no-empty-pattern
          this.playerInputs.reduce((acc, [], index) => {
            if (index === playerIndex) {
              return acc;
            }
            return acc.length ? ", .captureFocus" + index : ".captureFocus" + index;
          }, "") + " .focusable"
        : "";
    if (antiPlayerIndex.startsWith(", ")) {
      antiPlayerIndex = antiPlayerIndex.slice(2);
    }

    const unfocusables = antiPlayerIndex.length ? Array.from(this.uiDiv.querySelectorAll(antiPlayerIndex)) : [];

    const capturedFocuses = this.uiDiv.querySelector(
      `.captureFocus${playerIndex}:not(:has(.captureFocus${playerIndex}))`
    );
    let focusables;
    let div: Element = this.uiDiv;
    if (capturedFocuses) {
      div = capturedFocuses;
    }
    focusables = div.querySelectorAll(autoFocus ? ".autoFocus" : ".focusable");
    focusables = Array.from(focusables).filter((x) => !unfocusables.includes(x));
    return focusables;
  };

  findClosestFocusableElement(
    elementCenter: { x: number; y: number } | undefined,
    direction: {
      x: 1 | -1 | 0;
      y: 1 | -1 | 0;
    },
    playerIndex: number
  ): UIElement | undefined {
    if (!elementCenter) {
      elementCenter = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      };
    }

    let closestElement: UIElement | undefined;
    let closestDistance = Infinity;
    let closestAngle = 180;
    const candidates: any = [];
    const focusables = this.getFocusables(playerIndex);
    focusables.forEach((focusable) => {
      const center = this.getElementCenter(focusable);
      if (!center || (center.x === elementCenter!.x && center.y === elementCenter!.y)) {
        return;
      }

      // filter out if not in the right direction
      if (direction.x === 1 && center.x <= elementCenter!.x) {
        return;
      }
      if (direction.x === -1 && center.x >= elementCenter!.x) {
        return;
      }
      if (direction.y === 1 && center.y <= elementCenter!.y) {
        return;
      }
      if (direction.y === -1 && center.y >= elementCenter!.y) {
        return;
      }

      candidates.push([focusable, center]);
    });

    if (candidates.length === 0) {
      return;
    }
    for (let i = 0; i < candidates.length; i++) {
      const [focusable, center] = candidates[i];

      const angle = Math.atan2(center.y - elementCenter.y, center.x - elementCenter.x) * (180 / Math.PI);
      let distance = Math.sqrt((center.x - elementCenter.x) ** 2 + (center.y - elementCenter.y) ** 2);
      const directionAngle = Math.atan2(direction.y, direction.x) * (180 / Math.PI);
      // Calculate the angle difference between the direction and the element
      const angleDifference = Math.abs(directionAngle - angle);

      if (Math.abs(angleDifference) > 30) {
        continue;
      }
      distance *= (Math.abs(angleDifference) / 30) * 1 + 1;

      if (!closestDistance || distance < closestDistance) {
        closestDistance = distance;
        closestAngle = angleDifference;
        closestElement = this.mappedIds[focusable.id];
      }
    }
    if (!closestElement) {
      for (let i = 0; i < candidates.length; i++) {
        const [focusable, center] = candidates[i];
        const distance = Math.sqrt((center.x - elementCenter.x) ** 2 + (center.y - elementCenter.y) ** 2);
        if (distance && distance < closestDistance) {
          closestDistance = distance;
          closestElement = this.mappedIds[focusable.id];
        }
      }
    }

    return closestElement;
  }

  root: RootUIElement;

  addToUI(element: UIElement) {
    if (!this.root._element) {
      console.error("Root element is not set");
      return;
    }
    element.parent = this.root;
    this.debouncedFocusCheck();
  }

  debouncedFocusCheck = debounce(
    () => {
      const playerIndices = this.playerInputs.map(([, index]) => index);
      for (let i = 0; i < playerIndices.length; i++) {
        const playerIndex = playerIndices[i];
        this.attemptAutoFocus(playerIndex);
      }
    },
    20,
    {
      leading: false,
      trailing: true,
    }
  );

  removeFromUI(element: UIElement | UIElement[]) {
    if (!element) {
      return;
    }
    if (Array.isArray(element)) {
      element.forEach((e) => {
        if (e._parent && e._parent.config.children) {
          e._parent.config.children = e._parent.config.children.filter((x: any) => x !== e);
        }
        if (e.onDestroy) {
          e.onDestroy();
        }
        if (e) {
          this.elements.splice(this.elements.indexOf(e), 1);
          delete this.uiElements[e.id];
        }
      });
    } else {
      if (element._parent && element._parent.config.children) {
        element._parent.config.children = element._parent.config.children.filter((x: any) => x !== element);
      }
      if (element.onDestroy) {
        element.onDestroy();
      }
      const eleIndex = this.elements.indexOf(element);
      if (eleIndex === -1) {
        return;
      }
      this.elements.splice(this.elements.indexOf(element), 1);
      delete this.uiElements[element.id];
    }
  }

  getById(id: string) {
    const needle = this.elements.find((x) => x.id === id);
    if (!needle) {
      return undefined;
      // throw new Error(`Could not find element with ID ${id}`)
    }
    return needle;
  }

  removeFromUIByID(id: string) {
    const needle = this.elements.find((x) => x.id === id);
    if (needle !== undefined) {
      needle.onDestroy();
      this.elements.splice(this.elements.indexOf(needle), 1);
      delete this.uiElements[id];
    } else {
      console.warn(`could not find element with ID: ${id}`);
    }
  }

  clearUI() {
    console.log("Clearing UI");
    this.disableKeyCapture();

    if (this.debugCanvas) {
      this.debugCtx.clearRect(0, 0, this.debugCanvas.width, this.debugCanvas.height);
    }

    this.elements.forEach((x) => {
      if (x.onDestroy) {
        x.onDestroy(true);
      }
    });
    Object.entries(this.uiElements).forEach(([key, value]) => {
      delete this.uiElements[key];
    });
    this._focusedElementByPlayerIndex = [];
    this._focusedElementPositionByPlayerIndex = {};
    this.mappedIds = {};
    this.elements = [];
  }

  playSound(name: string, options?: PlaySoundOptions) {
    playSound(name, options);
  }
}
