import { beforeEach, describe, expect, it, vi } from "vitest";

import { setGlobalSingleton } from "yage/global";
import { InputEventType } from "yage/inputs/InputManager";
import { Button } from "yage/ui/Button";
import { Position } from "yage/ui/Rectangle";
import { UIService } from "yage/ui/UIService";

describe("UI touch focus", () => {
  beforeEach(() => {
    const uiDiv = document.createElement("div");
    const interactionDiv = document.createElement("div");
    const originalGetElementById = document.getElementById;

    document.getElementById = vi.fn((id: string) => {
      if (id === "ui") {
        return uiDiv;
      }
      if (id === "interaction") {
        return interactionDiv;
      }
      return originalGetElementById.call(document, id);
    }) as typeof document.getElementById;

    setGlobalSingleton("UIService", undefined);
  });

  it("updates focus when a focusable button is clicked via touch", () => {
    const button = new Button(new Position(0, 0), { label: "Tap me" });
    const service = UIService.getInstance();

    service.playerInputs = [[InputEventType.TOUCH, 0]];
    service.uiDiv.querySelectorAll = vi.fn(() => [button.element] as unknown as NodeListOf<Element>) as unknown as typeof service.uiDiv.querySelectorAll;
    service.uiDiv.querySelector = vi.fn(() => null) as typeof service.uiDiv.querySelector;

    const setFocusSpy = vi.spyOn(service, "setFocusedElementByPlayerIndex");

    button.element.onclick?.({
      stopPropagation: vi.fn(),
    } as any);

    expect(setFocusSpy).toHaveBeenCalledWith(0, button);
    expect(service.elementFocusIndices(button)).toEqual([0]);
  });
});
