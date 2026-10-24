// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { InputManager } from "yage/inputs/InputManager";
import { PointerListener } from "yage/inputs/PointerListener";

// test/setup.ts stubs document/window for node suites; this one uses jsdom's real DOM.
vi.unstubAllGlobals();

const pointer = (type: string, init: Record<string, number> = {}) => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.x ?? 0, clientY: init.y ?? 0, buttons: init.buttons ?? 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
};
const wheel = (deltaY: number, deltaMode = 0) => new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, deltaMode });

describe("PointerListener", () => {
  test("feeds pointer state, wheel deltas and raw events, and stops after destroy", () => {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const input = new InputManager();
    const listener = new PointerListener(input, element);
    const seen: string[] = [];
    const off = listener.onPointer((kind) => seen.push(kind));

    element.dispatchEvent(pointer("pointerdown", { x: 10, y: 20, buttons: 1 }));
    expect(input.getPointerState()).toEqual({ mousePosition: { x: 10, y: 20 }, buttons: 1, active: true });
    element.dispatchEvent(pointer("pointermove", { x: 12, y: 25, buttons: 1 }));
    element.dispatchEvent(pointer("pointerup", { x: 12, y: 25 }));
    expect(input.getPointerState().buttons).toBe(0);
    element.dispatchEvent(pointer("pointerleave"));
    expect(input.getPointerState()).toEqual({ mousePosition: { x: 12, y: 25 }, buttons: 0, active: false });

    const scroll = wheel(3, 1);
    element.dispatchEvent(scroll);
    element.dispatchEvent(wheel(-10));
    expect(scroll.defaultPrevented).toBe(true);
    expect(input.consumeWheelDelta()).toEqual({ x: 0, y: 38 });
    expect(input.consumeWheelDelta()).toEqual({ x: 0, y: 0 });
    expect(seen).toEqual(["down", "move", "up", "leave", "wheel", "wheel"]);

    off();
    element.dispatchEvent(pointer("pointermove", { x: 1, y: 1 }));
    expect(seen.length).toBe(6);
    listener.destroy();
    element.dispatchEvent(pointer("pointermove", { x: 99, y: 99 }));
    element.dispatchEvent(wheel(5));
    expect(input.getPointerState().mousePosition).toEqual({ x: 1, y: 1 });
    expect(input.consumeWheelDelta()).toEqual({ x: 0, y: 0 });
  });
});
