import type { KeyMap } from "@/inputs/InputManager";

export const keyPressed = (keyList: string[], keys: KeyMap, prevKeys: KeyMap) => {
  if (!prevKeys || !keys) {
    return false;
  }
  return keyList.some((key: string) => keys.get(key) === true && keys.get(key) !== prevKeys.get(key));
};

export const keyDown = (keyList: string[], keys: KeyMap) => {
  if (!keys) {
    return false;
  }
  return keyList.some((key: string) => keys.get(key) === true);
};
