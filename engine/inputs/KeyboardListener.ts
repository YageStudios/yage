import type { InputManager } from "./InputManager";
import { InputEventType } from "./InputManager";

export class KeyboardListener {
  // eslint-disable-next-line @typescript-eslint/ban-types
  registry: { [key: string]: Function[] } = {};
  constructor(public inputManager: InputManager) {
    const interactionDiv = document.body;

    interactionDiv.addEventListener("keydown", this.handleKeyDown);
    interactionDiv.addEventListener("keyup", this.handleKeyUp);
  }

  init(keys?: string[]) {
    if (!keys) {
      this.on("keydown-*", (key: string, event: Event) => {
        this.inputManager.dispatchEvent(key, true, InputEventType.KEYBOARD, 0, event);
      });
      this.on("keyup-*", (key: string) => {
        this.inputManager.dispatchEvent(key, false, InputEventType.KEYBOARD, 0, event);
      });
    } else {
      for (const key of keys) {
        this.on(`keydown-${key}`, (_key: string, event: Event) =>
          this.inputManager.dispatchEvent(key, true, InputEventType.KEYBOARD, 0, event)
        );
        this.on(`keyup-${key}`, (_key: string, event: Event) =>
          this.inputManager.dispatchEvent(key, false, InputEventType.KEYBOARD, 0, event)
        );
      }
    }
  }

  destroy() {
    const interactionDiv = document.body as HTMLElement;

    interactionDiv.removeEventListener("keydown", this.handleKeyDown);
    interactionDiv.removeEventListener("keyup", this.handleKeyUp);

    this.registry = {};
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
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
    // convert code to key
    if (e.code) {
      const convertedCode = e.code
        .toLowerCase()
        .replace("bracketleft", "[")
        .replace("bracketright", "]")
        .replace("backquote", "`")
        .replace("backslash", "\\")
        .replace("comma", ",")
        .replace("period", ".")
        .replace("slash", "/")
        .replace("semicolon", ";")
        .replace("quote", "'")
        .replace("minus", "-")
        .replace("equal", "=")
        .replace(/key|digit|right|left/g, "");
      if (convertedCode.length === 1) {
        key = convertedCode;
      }
    }
    if (key.startsWith("arrow")) {
      key = key.substring(5);
    } else if (key === " ") {
      key = "space";
    }
    if (this.registry[`${prefix}-${key}`]) {
      const callbacks = this.registry[`${prefix}-${key}`];
      for (let i = 0; i < callbacks.length; ++i) {
        callbacks[i](key, e);
      }
    }
    if (this.registry[`${prefix}-*`]) {
      const callbacks = this.registry[`${prefix}-*`];
      for (let i = 0; i < callbacks.length; ++i) {
        callbacks[i](key, e);
      }
    }
  }
}
