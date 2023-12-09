import type { KeyMap, MappedKeys } from "@/inputs/InputManager";

export const keyPressed = (keyList: MappedKeys[], keys: KeyMap, prevKeys: KeyMap) => {
  if (!prevKeys || !keys) {
    return false;
  }
  return keyList.some((key: MappedKeys) => keys.get(key) === true && keys.get(key) !== prevKeys.get(key));
};

export const keyDown = (keyList: MappedKeys[], keys: KeyMap) => {
  if (!keys) {
    return false;
  }
  return keyList.some((key: MappedKeys) => keys.get(key) === true);
};
