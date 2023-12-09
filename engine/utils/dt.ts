import type { Vector2d } from "./vector";
import { isVector2d, scaleVector2d } from "./vector";

const deltaTime = 16.6666;

const secondTime = deltaTime / 1000;

const dt = <T>(arg?: undefined | T, scale = 1): T => {
  const _secondTime = scale !== 1 ? secondTime * scale : secondTime;
  if (arg === undefined) {
    return (deltaTime * scale) as unknown as T;
  }
  if (typeof arg === "number") {
    return (arg * _secondTime) as unknown as T;
  }
  if (isVector2d(arg)) {
    return scaleVector2d(arg as Vector2d, _secondTime) as unknown as T;
  }
  return arg;
};

export default dt;

export const increment = (current: number, max: number, delta: number) => {
  const next = current + dt(delta);
  if (next >= max) {
    return 0;
  }
  return next;
};
