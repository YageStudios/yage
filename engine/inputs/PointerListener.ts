import type { InputManager } from "./InputManager";

export type PointerKind = "down" | "move" | "up" | "cancel" | "leave" | "wheel";
export type PointerCallback = (kind: PointerKind, event: PointerEvent | WheelEvent) => void;

export interface PointerListenerOptions {
  /** Suppress the context menu on the element (right-drag gestures). Default false. */
  preventContextMenu?: boolean;
  /** preventDefault on wheel events so the page doesn't scroll (makes the listener non-passive). Default true. */
  preventWheelScroll?: boolean;
  /** Capture the pointer on down so drags keep reporting outside the element. Default true. */
  capture?: boolean;
}

const LINE_PX = 16;

/**
 * Feeds pointer and wheel input on `element` into an InputManager: pointer state (client
 * coordinates and `buttons`, like MouseManager) via setPointerState / setPointerInactive, and wheel
 * movement in pixels via addWheelDelta (read it with inputManager.consumeWheelDelta()). Raw events
 * also go to `onPointer` callbacks. Needs no #interaction element.
 */
export class PointerListener {
  private callbacks: PointerCallback[] = [];
  private readonly options: Required<PointerListenerOptions>;

  constructor(public inputManager: InputManager, public element: HTMLElement = document.body, options: PointerListenerOptions = {}) {
    this.options = { preventContextMenu: false, preventWheelScroll: true, capture: true, ...options };
    element.addEventListener("pointerdown", this.handleDown);
    element.addEventListener("pointermove", this.handleMove);
    element.addEventListener("pointerup", this.handleUp);
    element.addEventListener("pointercancel", this.handleCancel);
    element.addEventListener("pointerleave", this.handleLeave);
    element.addEventListener("wheel", this.handleWheel, { passive: !this.options.preventWheelScroll });
    if (this.options.preventContextMenu) element.addEventListener("contextmenu", this.handleContextMenu);
  }

  /** Called with every pointer/wheel event after the InputManager is updated. Returns an unsubscribe. */
  onPointer(callback: PointerCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter((c) => c !== callback);
    };
  }

  destroy() {
    const element = this.element;
    element.removeEventListener("pointerdown", this.handleDown);
    element.removeEventListener("pointermove", this.handleMove);
    element.removeEventListener("pointerup", this.handleUp);
    element.removeEventListener("pointercancel", this.handleCancel);
    element.removeEventListener("pointerleave", this.handleLeave);
    element.removeEventListener("wheel", this.handleWheel);
    element.removeEventListener("contextmenu", this.handleContextMenu);
    this.callbacks = [];
  }

  private emit(kind: PointerKind, event: PointerEvent | WheelEvent) {
    for (const callback of this.callbacks) callback(kind, event);
  }

  private handleDown = (e: PointerEvent) => {
    if (this.options.capture) this.element.setPointerCapture?.(e.pointerId);
    this.inputManager.setPointerState(e.clientX, e.clientY, e.buttons);
    this.emit("down", e);
  };
  private handleMove = (e: PointerEvent) => {
    this.inputManager.setPointerState(e.clientX, e.clientY, e.buttons);
    this.emit("move", e);
  };
  private handleUp = (e: PointerEvent) => {
    if (this.element.hasPointerCapture?.(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
    this.inputManager.setPointerState(e.clientX, e.clientY, e.buttons);
    this.emit("up", e);
  };
  private handleCancel = (e: PointerEvent) => {
    this.inputManager.setPointerInactive();
    this.emit("cancel", e);
  };
  private handleLeave = (e: PointerEvent) => {
    // A captured drag keeps going outside the element.
    if (this.element.hasPointerCapture?.(e.pointerId)) return;
    this.inputManager.setPointerInactive();
    this.emit("leave", e);
  };
  private handleWheel = (e: WheelEvent) => {
    if (this.options.preventWheelScroll) e.preventDefault();
    const scale = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? (this.element.clientHeight || window.innerHeight) : 1;
    this.inputManager.addWheelDelta(e.deltaX * scale, e.deltaY * scale);
    this.emit("wheel", e);
  };
  private handleContextMenu = (e: Event) => e.preventDefault();
}
