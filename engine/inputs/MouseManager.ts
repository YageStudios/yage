import type { Vector2d } from "@/utils/vector";

export class MouseManager {
  mousePosition: Vector2d = { x: 0, y: 0 };
  buttons = 0;

  constructor() {
    const interactionDiv = document.getElementById("interaction") as HTMLElement;
    interactionDiv.addEventListener("mousemove", this.handleMouseMove.bind(this));
    interactionDiv.addEventListener("mousedown", this.handleMouseDown.bind(this));
    interactionDiv.addEventListener("mouseup", this.handleMouseUp.bind(this));
  }

  private handleMouseMove(e: MouseEvent) {
    this.mousePosition.x = e.clientX;
    this.mousePosition.y = e.clientY;
    // this.buttons = e.buttons;
  }

  private handleMouseDown(e: MouseEvent) {
    this.buttons = e.buttons;
  }

  private handleMouseUp() {
    this.buttons = 0;
  }
}
