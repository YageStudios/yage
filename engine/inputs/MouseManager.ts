import type { Vector2d } from "yage/utils/vector";
import type { InputManager } from "./InputManager";

export class MouseManager {
  mousePosition: Vector2d = { x: 0, y: 0 };
  buttons = 0;

  constructor(inputManager?: InputManager) {
    this.inputManager = inputManager;
    const interactionDiv = document.getElementById("interaction") as HTMLElement;
    interactionDiv.addEventListener("mousemove", this.handleMouseMove.bind(this));
    interactionDiv.addEventListener("mousedown", this.handleMouseDown.bind(this));
    interactionDiv.addEventListener("mouseup", this.handleMouseUp.bind(this));
  }

  private inputManager?: InputManager;

  private handleMouseMove(e: MouseEvent) {
    this.mousePosition.x = e.clientX;
    this.mousePosition.y = e.clientY;
    this.inputManager?.setPointerState(e.clientX, e.clientY, e.buttons);
  }

  private handleMouseDown(e: MouseEvent) {
    this.buttons = e.buttons;
    this.inputManager?.setPointerState(this.mousePosition.x, this.mousePosition.y, e.buttons);
  }

  private handleMouseUp() {
    this.buttons = 0;
    this.inputManager?.setPointerState(this.mousePosition.x, this.mousePosition.y, 0);
  }
}
