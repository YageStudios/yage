type GamepadRegionId = { type: "axis" | "button" | "dpad" | "trigger"; index: number | number[]; deadzone?: number };
type TouchRegionId = { x: number; y: number; width: number; height: number; deadzone?: number };

export type InputRegion = {
  id: GamepadRegionId | TouchRegionId;
  type: "tap" | "joystick" | "dpad" | "longpress" | "doubletap";
  key: string | string[];
  skew?: { zone: [number, number]; keys: [string, string] };
};

export type TouchRegion = InputRegion & {
  id: TouchRegionId;
  index: number;
};

export type GamepadRegion = InputRegion & {
  id: GamepadRegionId;
};

export const isGamepadRegion = (region: InputRegion): region is GamepadRegion => {
  return "index" in region.id;
};

export const isTouchRegion = (region: InputRegion): region is TouchRegion => {
  return "x" in region.id;
};
