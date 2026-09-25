import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import JSON5 from "json5";
import { UiLoader } from "yage/loader/UiLoader";
import { buildUiMap } from "yage/ui/UiMap";
import { UIService } from "yage/ui/UIService";
import { setGlobalSingleton } from "yage/global";
import type { UIElement } from "yage/ui/UIElement";

// Mirrors the context TicTacToeUISystem builds for an in-progress game.
const tictactoeContext = () => ({
  statusMessage: "Turn: X",
  showReset: false,
  cells: ["", "", "", "", "", "", "", "", ""].map((mark, i) => ({ mark, cellIndex: i })),
  cursorIndex: 0,
  currentPlayer: 0,
  boardFocusable: true,
  boardCaptureFocus: 0,
  boardAutoFocus: true,
  resetAutoFocus: false,
});

const collectTexts = (elements: UIElement[], out: { text: any; visible: boolean }[] = []) => {
  for (const element of elements) {
    const config: any = (element as any)._config;
    if (config?.text !== undefined || config?.label !== undefined) {
      out.push({ text: config.text ?? config.label, visible: element.isVisible() });
    }
    if (config?.children?.length) {
      collectTexts(config.children, out);
    }
  }
  return out;
};

describe("TicTacToeUI asset builds", () => {
  it("produces a visible status text element bound to statusMessage", async () => {
    const uiDiv = document.createElement("div");
    const interactionDiv = document.createElement("div");
    document.getElementById = vi.fn((id: string) => (id === "ui" ? uiDiv : id === "interaction" ? interactionDiv : null)) as any;
    setGlobalSingleton("UIService", undefined);
    const service = UIService.getInstance();

    await (async () => {
      const assetPath = "TicTacToeUI.json5";
      UiLoader.getInstance().registerOverride(
        assetPath,
        JSON5.parse(readFileSync("examples/assets/ui/TicTacToeUI.json5", "utf8"))
      );
      await UiLoader.getInstance().loadUi("tictactoe-debug", assetPath);
    })();
    const asset = UiLoader.getInstance().get("tictactoe-debug");
    expect(asset).toBeDefined();

    const map = buildUiMap(asset);
    const built = map.build(tictactoeContext(), vi.fn());
    const elements = Object.values(built);
    for (const element of elements) {
      service.addToUI(element);
    }

    const texts = collectTexts(elements as UIElement[]);
    // Diagnostic assertions: what actually came out of the build?
    console.log(
      "built roots:",
      elements.map((e) => (e as any)._config?.type ?? e?.constructor?.name),
      "texts:",
      JSON.stringify(texts)
    );

    expect(texts.some((t) => String(t.text).includes("Turn: X") && t.visible)).toBe(true);
  });
});
