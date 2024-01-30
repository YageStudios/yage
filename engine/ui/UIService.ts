import type { RootUIElement, UIElement } from "./UIElement";
import type { Vector2d } from "../utils/vector";
import { getGlobalSingleton, setGlobalSingleton } from "@/global";

export class UIService {
  elements: UIElement[] = [];
  UICanvas: HTMLCanvasElement;
  clickedElement: UIElement | null;
  clickedElements: UIElement[] | null;
  mouseOffset: Vector2d | null;
  interactionDiv: HTMLElement;
  uiDiv: HTMLDivElement;

  uiElements: { [key: string]: UIElement } = {};

  keyPressListeners: ((key: string) => void)[] = [];

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

  constructor(uiCanvas: HTMLCanvasElement) {
    this.UICanvas = uiCanvas;
    this.interactionDiv = document.getElementById("interaction") as HTMLElement;
    this.uiDiv = document.getElementById("ui") as HTMLDivElement;
    this.registerResizeEvents();
    this.root = {
      isVisible: () => true,
      update: () => {
        this.elements.forEach((element) => {
          element.update();
        });
      },
      addChild: (child: UIElement) => {
        if (!this.elements.includes(child)) {
          this.elements.push(child);
        }
        child.update();
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

  registerResizeEvents() {
    window.addEventListener("resize", () => {
      this.elements.forEach((element) => {
        element.update();
      });
      setTimeout(() => {
        this.elements.forEach((element) => {
          element.update();
        });
      }, 100);
    });
  }

  addKeyPressListener(listener: (key: string) => void) {
    this.keyPressListeners.push(listener);
    return () => {
      this.keyPressListeners = this.keyPressListeners.filter((l) => l !== listener);
    };
  }

  root: RootUIElement;

  addToUI(element: UIElement) {
    if (!this.root._element) {
      console.error("Root element is not set");
      return;
    }
    element.parent = this.root;
    // console.log(element);
    // this.elements.push(element);
    // this.uiElements[element.id] = element;
    // if (!element?.update) {
    //   console.error('Element does not have an "update" method', element);
    //   return;
    // }
    // element.update();
  }

  removeFromUI(element: UIElement | UIElement[]) {
    if (!element) {
      return;
    }
    if (Array.isArray(element)) {
      element.forEach((e) => {
        if (e.config.children?.length) {
          e.config.children.forEach((child: any) => {
            this.removeFromUI(child);
          });
        }
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
      if (element.config.children?.length) {
        element.config.children.forEach((child: any) => {
          this.removeFromUI(child);
        });
      }
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
    this.elements.forEach((x) => {
      if (x.onDestroy) {
        x.onDestroy();
      }
    });
    Object.entries(this.uiElements).forEach(([key, value]) => {
      delete this.uiElements[key];
    });
    this.elements = [];
  }
}
