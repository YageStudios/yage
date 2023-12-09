import type { GameModel } from "@/game/GameModel";
import type { Position, Rectangle } from "./Rectangle";
import { UIElement, UIElementConfig } from "./UIElement";
import AssetLoader from "@/loader/AssetLoader";
import { rectToCanvasSpace } from "./utils";

export type BoxConfig = UIElementConfig & {
  onClick?: () => boolean | void;
  onMouseDown?: () => boolean | void;
  onMouseUp?: () => boolean | void;
  onBlur?: () => void;
  style?: Partial<CSSStyleDeclaration>;
};

const defaultStyle: Partial<CSSStyleDeclaration> = {
  position: "absolute",
  textAlign: "center",
  color: "white",
  backgroundColor: "transparent",
  border: "1px solid",
  borderColor: "black",
  padding: "0",
  margin: "0",
  pointerEvents: "none",
  overflow: "visible",
};

export class Box<T extends BoxConfig = BoxConfig> extends UIElement<T> {
  protected _element: HTMLDivElement | undefined = undefined;
  protected _hasChanged = true;

  constructor(bounds: Rectangle | Position, _config: Partial<T> = {}) {
    super(bounds, _config, defaultStyle);
  }

  protected onClickInternal(): void | boolean {
    if (this._config.onClick) {
      return this._config.onClick();
    }
  }

  protected onMouseDownInternal(): void | boolean {
    if (this._config.onMouseDown) {
      return this._config.onMouseDown();
    }
  }

  protected onBlurInternal(): void {
    if (this._config.onBlur) {
      this._config.onBlur();
    }
  }

  protected onMouseUpInternal(): void | boolean {
    if (this._config.onMouseUp) {
      return this._config.onMouseUp();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-empty-function
  protected updateInternal(gameModel: GameModel): void {}

  protected drawInternal(ctx: CanvasRenderingContext2D, ui: HTMLDivElement): void {
    const boxElement = this._element ?? document.createElement("div");

    if (!this._element) {
      ui.appendChild(boxElement);
      this._element = boxElement;
    }
  }
}
