/* eslint-disable @typescript-eslint/ban-types */
export enum InputEventData {
  ARROW_DOWN,
  ARROW_UP,
  ARROW_LEFT,
  ARROW_RIGHT,
}

export enum EventType {
  KEY_DOWN = "KEY_DOWN",
}

export enum MappedKeys {
  ARROW_DOWN = "down",
  ARROW_UP = "up",
  ARROW_LEFT = "left",
  ARROW_RIGHT = "right",
  ARROW_DOWN_ALT = "s",
  ARROW_UP_ALT = "w",
  ARROW_LEFT_ALT = "a",
  ARROW_RIGHT_ALT = "d",
  ARROW_DOWN_ALT2 = "k",
  ARROW_UP_ALT2 = "i",
  ARROW_LEFT_ALT2 = "j",
  ARROW_RIGHT_ALT2 = "l",
  INTERACT = "e",
  USE = "q",
  SPACE = "space",
  SHIFT = "shift",
  ESC = "escape",
  TILDE = "`",
  TAB = "tab",
}

export type KeyMap = Map<string, boolean>;

export type EventRecord = { playerId: string; key: MappedKeys; value: boolean };

export enum EVENT_TYPE {
  TOUCH,
  KEYBOARD,
  GAMEPAD,
  MOUSE,
}

export class KeyMapInput {
  keyMap: KeyMap;

  clone(): KeyMapInput {
    const clone = new KeyMapInput();
    clone.keyMap = new Map(this.keyMap);
    return clone;
  }
}
export class InputManager {
  public keyMap: KeyMap;

  private changes: { [key: string]: boolean } = {};
  private keyListeners: Function[] = [];

  public getKeyboardChanges() {
    if (Object.keys(this.changes).length === 0) {
      return false;
    }
    const changes = this.changes;
    this.changes = {};
    return changes;
  }

  public getKeyMap(): KeyMap {
    return this.clone();
  }

  constructor() {
    this.keyMap = this.buildKeyMap();
  }

  public toKeyMap(obj: { [key: string]: boolean }) {
    const keyMap = this.buildKeyMap();
    for (const key in obj) {
      keyMap.set(key as any, obj[key]);
    }
    return keyMap;
  }

  clone() {
    const clone = this.buildKeyMap();
    this.keyMap.forEach((value, key) => {
      clone.set(key, value);
    });
    return clone;
  }

  public buildKeyMap(): KeyMap {
    // const newKeymap = new Map<MappedKeys, boolean>();
    // for (const x in MappedKeys) {
    //   const mappedKey: MappedKeys = MappedKeys[x as keyof typeof MappedKeys];
    //   newKeymap.set(mappedKey, false);
    // }
    // return newKeymap;
    return new Map<string, boolean>();
  }

  public addKeyListener(
    listener: (key: string, keyPressed: boolean, eventType: EVENT_TYPE, e?: Event) => void
  ): () => void {
    this.keyListeners.push(listener);
    return () => {
      this.keyListeners = this.keyListeners.filter((l) => l !== listener);
    };
  }

  public removeKeyListener(
    listener: (key: string, keyPressed: boolean, eventType: EVENT_TYPE, e?: Event) => void
  ): void {
    this.keyListeners = this.keyListeners.filter((l) => l !== listener);
  }

  dispatchEvent = (key: string, keyPressed: boolean, eventType: EVENT_TYPE, e?: Event) => {
    if (keyPressed) {
      this.keyMap.set(key, keyPressed);
    } else {
      this.keyMap.delete(key);
    }
    this.keyListeners.forEach((listener) => listener(key, keyPressed, eventType, e));
  };

  diffKeyMap(keyMap: KeyMap, prevKeyMap: KeyMap): KeyMap {
    const diffKeyMap = new Map<string, boolean>();
    keyMap.forEach((value, key) => {
      if (prevKeyMap?.get(key) !== value) {
        diffKeyMap.set(key, value);
      }
    });
    return diffKeyMap;
  }

  keyMapToJsonObject(keyMap: KeyMap): { [key: string]: boolean } {
    const obj: { [key: string]: boolean } = {};
    keyMap.forEach((value, key) => {
      if (value) {
        obj[key] = value;
      }
    });
    return obj;
  }
}
