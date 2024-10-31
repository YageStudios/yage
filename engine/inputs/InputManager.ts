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

export enum InputEventType {
  ANY,
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

  private keyMapsByType: { [key: string]: KeyMap[] } = {};

  private changes: { [key: string]: boolean } = {};
  private keyListeners: Function[] = [];

  public getKeyMap(type?: InputEventType, typeIndex: number = 0): KeyMap {
    return this.clone(type, typeIndex);
  }

  constructor(public combineKeyMaps = true) {
    this.keyMap = InputManager.buildKeyMap();
  }

  public toKeyMap(obj: { [key: string]: boolean }) {
    const keyMap = InputManager.buildKeyMap();
    for (const key in obj) {
      keyMap.set(key as any, obj[key]);
    }
    return keyMap;
  }

  clone(eventType?: InputEventType, typeIndex = 0): KeyMap {
    const clone = InputManager.buildKeyMap();

    let keyMap: KeyMap;
    if (this.combineKeyMaps || !eventType) {
      keyMap = this.keyMap;
    } else {
      if (!this.keyMapsByType[eventType]) {
        this.keyMapsByType[eventType] = [];
      }
      if (!this.keyMapsByType[eventType][typeIndex]) {
        this.keyMapsByType[eventType][typeIndex] = InputManager.buildKeyMap();
      }
      keyMap = this.keyMapsByType[eventType][typeIndex];
    }

    keyMap.forEach((value, key) => {
      clone.set(key, value);
    });
    return clone;
  }

  public static buildKeyMap(): KeyMap {
    // const newKeymap = new Map<MappedKeys, boolean>();
    // for (const x in MappedKeys) {
    //   const mappedKey: MappedKeys = MappedKeys[x as keyof typeof MappedKeys];
    //   newKeymap.set(mappedKey, false);
    // }
    // return newKeymap;
    return new Map<string, boolean>();
  }

  public addKeyListener(
    listener: (key: string, keyPressed: boolean, eventType: InputEventType, typeIndex: number, e?: Event) => void
  ): () => void {
    this.keyListeners.unshift(listener);
    return () => {
      this.keyListeners = this.keyListeners.filter((l) => l !== listener);
    };
  }

  public removeKeyListener(
    listener: (key: string, keyPressed: boolean, eventType: InputEventType, typeIndex: number, e?: Event) => void
  ): void {
    this.keyListeners = this.keyListeners.filter((l) => l !== listener);
  }

  dispatchEvent = (key: string, keyPressed: boolean, eventType: InputEventType, typeIndex = 0, e?: Event) => {
    let keyMap: KeyMap;

    if (this.keyListeners.some((listener) => listener(key, keyPressed, eventType, typeIndex, e) === false)) {
      return;
    }

    if (this.combineKeyMaps) {
      keyMap = this.keyMap;
    } else {
      if (!this.keyMapsByType[eventType]) {
        this.keyMapsByType[eventType] = [];
      }
      if (!this.keyMapsByType[eventType][typeIndex]) {
        this.keyMapsByType[eventType][typeIndex] = InputManager.buildKeyMap();
      }
      keyMap = this.keyMapsByType[eventType][typeIndex];
    }
    if (keyPressed) {
      keyMap.set(key, keyPressed);
    } else {
      keyMap.delete(key);
    }
  };

  keyMapToJsonObject(keyMap: KeyMap): { [key: string]: boolean } {
    const obj: { [key: string]: boolean } = {};
    keyMap.forEach((value, key) => {
      if (value) {
        obj[key] = value;
      }
    });
    return obj;
  }

  keyPressed(key: string, eventType?: InputEventType, typeIndex = 0) {
    if (eventType === undefined) {
      eventType = InputEventType.KEYBOARD;
    }
    if (this.combineKeyMaps || eventType === InputEventType.ANY) {
      return !!this.keyMap.get(key);
    }
    if (!this.keyMapsByType[eventType]) {
      return false;
    }
    if (!this.keyMapsByType[eventType][typeIndex]) {
      return false;
    }
    return !!this.keyMapsByType[eventType][typeIndex].get(key);
  }
}
