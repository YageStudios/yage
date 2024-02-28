import type { RootUIElement, UIElement } from "./UIElement";
import type { Vector2d } from "../utils/vector";
import { getGlobalSingleton, setGlobalSingleton } from "@/global";
import { EVENT_TYPE, InputManager } from "@/inputs/InputManager";
import { PlaySoundOptions, playSound } from "@/utils/playSound";
import { flags } from "@/console/flags";

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
  autoEmptyFocusElements: UIElement[] = [];

  keyPressListeners: ((key: string) => void)[] = [];

  lastMouseMove: number;
  debugCanvas: any;
  unsub: (() => void) | undefined;

  ui: { [key: string]: UIElement } = new Proxy(this.uiElements, {
    get: (target, prop) => {
      return target[prop as any];
    },
    set: (target, prop, value) => {
      if (target[prop as any]) {
        UIService.getInstance().removeFromUI(target[prop as any]);
      }
      target[prop as any] = value;
      // console.log(UIService.getInstance());
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

  _keyCaptureListener = (
    inputManager: InputManager,
    key: string,
    pressed: boolean,
    eventType: EVENT_TYPE,
    e?: Event
  ) => {
    if (!pressed || [EVENT_TYPE.TOUCH, EVENT_TYPE.MOUSE].includes(eventType)) {
      return;
    }
    let left = key === "left" || key === "a";
    let right = key === "right" || key === "d";
    let up = key === "up" || key === "w";
    let down = key === "down" || key === "s";
    if (eventType === EVENT_TYPE.GAMEPAD) {
      left =
        key === "left" ||
        (inputManager.keyPressed("a") && !inputManager.keyPressed("w") && !inputManager.keyPressed("s"));
      right =
        key === "right" ||
        (inputManager.keyPressed("d") && !inputManager.keyPressed("w") && !inputManager.keyPressed("s"));
      up =
        key === "up" ||
        (inputManager.keyPressed("w") && !inputManager.keyPressed("a") && !inputManager.keyPressed("d"));
      down =
        key === "down" ||
        (inputManager.keyPressed("s") && !inputManager.keyPressed("a") && !inputManager.keyPressed("d"));
    }

    if (left || right || up || down) {
      let direction = { x: 0, y: 0 };

      console.log(up, left, down, right);

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

      if (this._focusedElement?._element) {
        this.focusedElementPosition = this.getElementCenter(this._focusedElement._element);
      }
      const focusedElement = this.findClosestFocusableElement(
        this.focusedElementPosition,
        direction as { x: 0 | 1 | -1; y: 0 | 1 | -1 }
      );
      if (focusedElement) {
        this.focusedElement = focusedElement;
      }
      e?.preventDefault();
      e?.stopPropagation();
    }

    switch (key.toLocaleLowerCase()) {
      case "space":
        if (this.focusedElement) {
          this.focusedElement.onClick();
          e?.preventDefault();
          e?.stopImmediatePropagation();
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

    if (flags.DEBUG) {
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

  traverseParentFocus() {
    let nestedParent = this._focusedElement!._parent;
    while (nestedParent) {
      if (nestedParent.config.focusable) {
        // @ts-ignore
        this.focusedElement = nestedParent;
        return;
      }
      // @ts-ignore
      nestedParent = nestedParent._parent;
    }
    this.focusedElement = undefined;
  }

  _focusedElement: UIElement | undefined;
  focusedElementPosition: Vector2d | undefined;
  set focusedElement(element: UIElement | undefined) {
    const previous = this._focusedElement;
    this._focusedElement = element;
    if (element) {
      this.focusedElementPosition = this.getElementCenter(element._element);
      element._update();
    }
    if (!element) {
      setTimeout(() => {
        if (!this._focusedElement && this.autoEmptyFocusElements.length > 0) {
          let closest = this.autoEmptyFocusElements[0];
          if (previous && previous.config.autoEmptyFocus) {
            let closestDistance = Infinity;
            this.autoEmptyFocusElements.forEach((element) => {
              const center = this.getElementCenter(element._element)!;
              // favor the left
              center.x += 1;
              const distance =
                (center.x - (this.focusedElementPosition?.x ?? window.innerWidth / 2)) ** 2 +
                (center.y - (this.focusedElementPosition?.y ?? window.innerHeight / 2)) ** 2;
              if (distance < closestDistance) {
                closest = element;
                closestDistance = distance;
              }
            });
          }
          this.focusedElement = closest;
        }
      }, 0);
    }

    if (previous) {
      previous._update();
    }
  }

  get focusedElement() {
    return this._focusedElement;
  }

  clearFocusedElement() {
    const previous = this._focusedElement;
    this._focusedElement = undefined;
    this.focusedElementPosition = undefined;
    setTimeout(() => {
      if (previous && !previous?.destroyed) {
        previous._update();
      }
    }, 0);
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
    let bounds = element.getBoundingClientRect();
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
      const ctx = this.debugCtx;
      // draw a circle at the center on the debug canvas
      ctx.fillStyle = "red";
      ctx.strokeStyle = "green";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, 15, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }

    return center;
  };

  findClosestFocusableElement(
    elementCenter: { x: number; y: number } | undefined,
    direction: {
      x: 1 | -1 | 0;
      y: 1 | -1 | 0;
    }
  ): UIElement | undefined {
    if (!elementCenter) {
      elementCenter = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      };
    }

    const capturedFocuses = this.uiDiv.querySelector(".captureFocus:not(:has(.captureFocus)):has(.focused)");
    let focusables;
    if (capturedFocuses) {
      focusables = capturedFocuses.querySelectorAll(".focusable");
    } else {
      focusables = this.uiDiv.querySelectorAll(".focusable");
    }
    let closestElement: UIElement | undefined;
    let closestDistance = Infinity;
    let closestAngle = 180;
    const candidates: any = [];
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
  }

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
    this.elements.forEach((x) => {
      if (x.onDestroy) {
        x.onDestroy(true);
      }
    });
    Object.entries(this.uiElements).forEach(([key, value]) => {
      delete this.uiElements[key];
    });
    this._focusedElement = undefined;
    this.focusedElementPosition = undefined;
    this.autoEmptyFocusElements = [];
    this.mappedIds = {};
    this.elements = [];
  }

  playSound(name: string, options?: PlaySoundOptions) {
    playSound(name, options);
  }
}
