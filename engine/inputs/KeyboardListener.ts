import { InputManager } from "./InputManager";

export class KeyboardListener {
  registry: { [key: string]: Function[] } = {};
  constructor(public inputManager: InputManager) {
    const interactionDiv = document.body;

    interactionDiv.addEventListener("keydown", this.handleKeyDown);
    interactionDiv.addEventListener("keyup", this.handleKeyUp);

    document.addEventListener("keydown", (e) => {
      // if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      //   e.preventDefault();
      //   e.stopImmediatePropagation();
      //   e.stopPropagation();
      // }
    });
  }

  init(keys?: string[]) {
    if (!keys) {
      this.on("keydown-*", (key: string) => {
        this.inputManager.dispatchEvent(key, true);
      });
      this.on("keyup-*", (key: string) => {
        this.inputManager.dispatchEvent(key, false);
      });
    } else {
      for (const key of keys) {
        this.on(`keydown-${key}`, () => this.inputManager.dispatchEvent(key, true));
        this.on(`keyup-${key}`, () => this.inputManager.dispatchEvent(key, false));
      }
    }
  }

  destroy() {
    const interactionDiv = document.getElementById("interaction") as HTMLElement;

    interactionDiv.removeEventListener("keydown", this.handleKeyDown);
    interactionDiv.removeEventListener("keyup", this.handleKeyUp);

    this.registry = {};
  }

  on(key: string, callback: Function) {
    if (!this.registry[key]) {
      this.registry[key.toLowerCase()] = [];
    }
    this.registry[key.toLowerCase()].push(callback);
  }

  handleKeyDown = (e: KeyboardEvent) => {
    this.handleKey(e, "keydown");
  };
  handleKeyUp = (e: KeyboardEvent) => {
    this.handleKey(e, "keyup");
  };

  handleKey(e: KeyboardEvent, prefix: string) {
    let key = e.key.toLowerCase();
    if (key.startsWith("arrow")) {
      key = key.substring(5);
    } else if (key === " ") {
      key = "space";
    }
    if (this.registry[`${prefix}-${key}`]) {
      const callbacks = this.registry[`${prefix}-${key}`];
      for (let i = 0; i < callbacks.length; ++i) {
        callbacks[i]();
      }
    }
    if (this.registry[`${prefix}-*`]) {
      const callbacks = this.registry[`${prefix}-*`];
      for (let i = 0; i < callbacks.length; ++i) {
        callbacks[i](key);
      }
    }
  }
}
